import { nativeImage } from 'electron'
import { appendLine } from '../shared/text-changes'
import { IPC, type IpcApi } from '../shared/ipc'
import { publicUrl } from './public-url'
import { parseNote } from '../shared/parse'
import { formatLink, resolveLinkpath, splitSubpath } from '../shared/obsidian-links'
import { currentLinkSettings, currentLinkVault } from './link-context'
import * as vaultFs from './vault-fs'
import { queue } from './vault-tools/proposals'
import { readState, writeState } from './state'
import type { LinkPreview } from '../shared/canvas'
import { vimeoId, youTubeId } from '../shared/youtube'
import { asJpeg, renderedPreview } from './web-preview'
import { mostlyOneColour } from './picture-checks'

/**
 * What a canvas asks of main.
 *
 * "Make it a link": an edge between two notes on a canvas becomes a [[link]]
 * in the first note - shown as a Suggested edit to apply or discard, never
 * written straight away. It is the person's own action, so it does not go
 * through the AI's settings (write mode, excluded folders); it only uses the
 * same queue and diff.
 *
 * A link node's preview: the page fetched once - its title, description,
 * picture and icon, the pictures kept as small data URLs - and kept in
 * `.recto/canvas-links.json`, so a canvas never reaches out again for it.
 * Offline or refused, there is no preview, and the next open asks again.
 */

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function registerCanvasIpc(handle: Handle): void {
  handle(IPC.canvasProposeLink, async (from, to) => {
    const read = await vaultFs.readFile(from)
    if (!read.ok) return { ok: false as const, error: read.error }
    const notes = vaultFs.vaultFiles().filter((p) => p.toLowerCase().endsWith('.md'))
    if (!notes.includes(to)) return { ok: false as const, error: `“${name(to)}” is not a note in this vault.` }
    // Already linked: a link in it that Obsidian would read as this note. Nothing to suggest; the edge shows it.
    const vault = currentLinkVault()
    const already = parseNote(read.content).links.some((l) => resolveLinkpath(splitSubpath(l.target).path, from, vault) === to)
    if (already) return { ok: true as const, proposal: null }
    // Written as Obsidian would write it in that note, by the vault's "New link format".
    const link = formatLink(to, from, vault, currentLinkSettings())
    const before = read.content
    const after = appendLine(before, link)
    const made = queue(
      { summary: `Link “${name(from)}” to “${name(to)}”`, files: [{ path: from, before, after }], formatted: [] },
      'recto-canvas',
      'make_link',
    )
    return { ok: true as const, proposal: made.id }
  })
}

const LINKS = 'canvas-links'
/**
 * Kept previews made since a page's own picture is used only when it is a real
 * one (`cover`) and the page's top is the picture otherwise (web-preview.ts).
 * Older ones are asked for again, once.
 */
const KEPT_VERSION = 3
type Kept = LinkPreview & { v?: number }
/** How much of a page is read for its tags, and how big a picture is kept. */
const PAGE_BYTES = 512 * 1024
const IMAGE_BYTES = 200 * 1024
/** A page's own picture is fetched up to this, then made a JPEG the card's size. */
const COVER_BYTES = 5 * 1024 * 1024
/** Smaller than this, or not wider than tall, a page's picture is a logo or an icon, not its picture. */
const COVER_MIN_WIDTH = 600
const COVER_MIN_RATIO = 1.2
const TIMEOUT_MS = 6000

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** A `<meta>` value by its property or name, whichever order its attributes are in. */
function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i')
  const tag = re.exec(html)?.[0]
  const content = tag === undefined ? undefined : /content=["']([^"']*)["']/i.exec(tag)?.[1]
  return content === undefined || content.trim() === '' ? null : decode(content)
}

async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  if (response.body === null) return null
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel()
      return parts.length === 0 ? null : concat(parts)
    }
    parts.push(value)
  }
  return concat(parts)
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/** A fetch that stays on the public web: each redirect is checked before it is followed, a few at most. */
async function fetchPublic(url: URL, headers: Record<string, string> = {}): Promise<Response | null> {
  let at = url
  for (let hops = 0; hops < 4; hops++) {
    if (!(await publicUrl(at))) return null
    const response = await fetch(at, { signal: AbortSignal.timeout(TIMEOUT_MS), headers, redirect: 'manual' })
    const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
    if (next === null) return response
    at = new URL(next, at)
  }
  return null
}

/** A picture on the web as a data URL, or null if it is not one, or too big. */
async function picture(url: string | null, base: string): Promise<string | null> {
  if (url === null) return null
  try {
    const target = new URL(url, base)
    const response = await fetchPublic(target)
    if (response === null) return null
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/')) return null
    const bytes = await readCapped(response, IMAGE_BYTES)
    if (bytes === null || bytes.byteLength >= IMAGE_BYTES) return null
    return `data:${type.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`
  } catch {
    return null
  }
}

/**
 * A page's own picture (og:image) as the card's, only when it is a real one:
 * big enough, wider than tall and not mostly one colour - a site's logo or
 * icon (Reddit's, The Verge's) is not a picture of the page, and the page's top is the better one then. Fetched
 * whole and kept as a JPEG the card's size; null when it is not one.
 */
async function cover(url: string | null, base: string): Promise<string | null> {
  if (url === null) return null
  try {
    const response = await fetchPublic(new URL(url, base))
    if (response === null || !response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) return null
    const bytes = await readCapped(response, COVER_BYTES)
    if (bytes === null || bytes.byteLength >= COVER_BYTES) return null
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    const { width, height } = image.getSize()
    if (image.isEmpty() || width < COVER_MIN_WIDTH || width < height * COVER_MIN_RATIO || mostlyOneColour(image.resize({ width: 48 }).toBitmap())) return null
    return asJpeg(image)
  } catch {
    return null
  }
}

/**
 * A YouTube video's preview from YouTube's own published ways in: its
 * oEmbed answer for the title and channel, and the thumbnail every video has
 * at a known address. Its page is no use - a plain fetch of it often gets a
 * consent page with no picture.
 */
async function youTubePreview(id: string, url: string): Promise<LinkPreview | null> {
  try {
    const oembed = await fetchPublic(new URL(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`))
    const info = oembed !== null && oembed.ok ? ((await oembed.json()) as { title?: unknown; author_name?: unknown }) : {}
    const image = await picture(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, url)
    if (image === null && typeof info.title !== 'string') return null
    return {
      title: typeof info.title === 'string' ? info.title : null,
      description: typeof info.author_name === 'string' ? info.author_name : null,
      image,
      icon: null,
    }
  } catch {
    return null
  }
}

/** A Vimeo video's preview from Vimeo's oEmbed: its title, maker and thumbnail. */
async function vimeoPreview(url: string): Promise<LinkPreview | null> {
  try {
    const answer = await fetchPublic(new URL(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`))
    if (answer === null || !answer.ok) return null
    const info = (await answer.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown }
    return {
      title: typeof info.title === 'string' ? info.title : null,
      description: typeof info.author_name === 'string' ? info.author_name : null,
      image: await picture(typeof info.thumbnail_url === 'string' ? info.thumbnail_url : null, url),
      icon: null,
    }
  } catch {
    return null
  }
}

/**
 * A link's preview: a video's from its site's own published ways in; a page's
 * from its HTML - and when that gives no title or no picture, from the page as
 * a browser shows it (web-preview.ts), what the plain read found kept first.
 */
async function preview(url: string): Promise<LinkPreview | null> {
  const video = youTubeId(url)
  if (video !== null) return youTubePreview(video, url)
  if (vimeoId(url) !== null) return vimeoPreview(url)
  const read = await pagePreview(url)
  if (read !== null && read.title !== null && read.image !== null) return read
  const shown = await renderedPreview(url, cover, picture)
  if (shown === null) return read
  return read === null
    ? shown
    : { title: read.title ?? shown.title, description: read.description ?? shown.description, image: read.image ?? shown.image, icon: read.icon ?? shown.icon }
}

async function pagePreview(url: string): Promise<LinkPreview | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  try {
    const response = await fetchPublic(target, { accept: 'text/html' })
    if (response === null || !response.ok || !(response.headers.get('content-type') ?? '').includes('html')) return null
    const bytes = await readCapped(response, PAGE_BYTES)
    if (bytes === null) return null
    const html = new TextDecoder().decode(bytes)
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]
    const title = meta(html, 'og:title') ?? (titleTag === undefined || titleTag.trim() === '' ? null : decode(titleTag))
    const iconHref = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i.exec(html)?.[0]
    const icon = iconHref === undefined ? '/favicon.ico' : (/href=["']([^"']+)["']/i.exec(iconHref)?.[1] ?? '/favicon.ico')
    return {
      title,
      description: meta(html, 'og:description') ?? meta(html, 'description'),
      image: await cover(meta(html, 'og:image'), response.url),
      icon: await picture(icon, response.url),
    }
  } catch {
    return null
  }
}

export function registerLinkPreviews(handle: Handle): void {
  handle(IPC.canvasLinkPreview, async (url, fresh) => {
    const kept = (readState(LINKS) ?? {}) as Record<string, Kept>
    // One kept from before is asked for again, once (KEPT_VERSION), and any on "Refresh preview";
    // kept still, if that finds nothing.
    const old = kept[url]
    if (fresh !== true && old !== undefined && old.v === KEPT_VERSION) return old
    const found = await preview(url)
    // Refreshed and found nothing: null says so (the card keeps the one it shows).
    if (found === null) return fresh === true ? null : (old ?? null)
    const next: Kept = { ...found, v: KEPT_VERSION }
    writeState(LINKS, { ...((readState(LINKS) ?? {}) as Record<string, Kept>), [url]: next })
    return next
  })
}

const FOLDS = 'canvas'

/** Recto's own data kept by a file's path: a canvas's folds and boards shown as text, a PDF's highlights. */
const BY_PATH = [FOLDS, 'pdf-highlights'] as const

/** A file (or a folder of them) renamed or moved: what Recto keeps about it moves too. */
export function moveCanvasState(from: string, to: string): void {
  for (const feature of BY_PATH) {
    const all = readState(feature)
    if (typeof all !== 'object' || all === null || Array.isArray(all)) continue
    const next: Record<string, unknown> = {}
    let changed = false
    for (const [key, value] of Object.entries(all as Record<string, unknown>)) {
      const moved = key === from ? to : key.startsWith(`${from}/`) ? `${to}${key.slice(from.length)}` : key
      if (moved !== key) changed = true
      next[moved] = value
    }
    if (changed) writeState(feature, next)
  }
}
