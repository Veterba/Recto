import { IPC, type IpcApi } from '../shared/ipc'
import { publicUrl } from './public-url'
import { parseNote, shortestLink } from '../shared/parse'
import * as vaultFs from './vault-fs'
import { queue } from './vault-tools/proposals'
import { readState, writeState } from './state'
import type { LinkPreview } from '../shared/canvas'
import { youTubeId } from '../shared/youtube'

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
    // Already linked: nothing to suggest; the edge simply shows it.
    const already = parseNote(read.content).links.some((l) => {
      const target = l.target.toLowerCase().replace(/\.md$/i, '')
      const whole = to.toLowerCase().replace(/\.md$/i, '')
      return whole === target || whole.endsWith(`/${target}`)
    })
    if (already) return { ok: true as const, proposal: null }
    // The shortest name that still says which note, as every link Recto writes.
    const link = `[[${shortestLink(to, notes)}]]`
    const before = read.content
    const after = `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${link}\n`
    const made = queue(
      { summary: `Link “${name(from)}” to “${name(to)}”`, files: [{ path: from, before, after }], formatted: [] },
      'recto-canvas',
      'make_link',
    )
    return { ok: true as const, proposal: made.id }
  })
}

const LINKS = 'canvas-links'
/** How much of a page is read for its tags, and how big a picture is kept. */
const PAGE_BYTES = 512 * 1024
const IMAGE_BYTES = 200 * 1024
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

async function preview(url: string): Promise<LinkPreview | null> {
  const video = youTubeId(url)
  if (video !== null) return youTubePreview(video, url)
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
      image: await picture(meta(html, 'og:image'), response.url),
      icon: await picture(icon, response.url),
    }
  } catch {
    return null
  }
}

export function registerLinkPreviews(handle: Handle): void {
  handle(IPC.canvasLinkPreview, async (url) => {
    const kept = (readState(LINKS) ?? {}) as Record<string, LinkPreview>
    // A YouTube preview kept from before without its picture is asked for again.
    if (kept[url] !== undefined && (youTubeId(url) === null || kept[url]!.image !== null)) return kept[url]!
    const found = await preview(url)
    if (found === null) return null
    writeState(LINKS, { ...((readState(LINKS) ?? {}) as Record<string, LinkPreview>), [url]: found })
    return found
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
