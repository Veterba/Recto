import { net, protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { resolveInVault } from './paths'
import { currentVault } from './vault'

/**
 * `recto-file://vault/<path>` — how the renderer loads an image out of the vault.
 *
 * A plain `file://` URL cannot work, and this is why images never rendered: the
 * renderer's origin is `http://localhost` in dev and `file://` from the app
 * bundle in a build, and Chromium refuses a local-resource load from the first
 * and treats the second as a cross-directory read. `webSecurity: false` would
 * "fix" it by removing the one thing keeping a markdown bug away from the disk.
 *
 * So: one scheme, one host, and every path through `resolveInVault`. A note
 * that says `![](../../../.ssh/id_rsa)` gets a 403, not a file.
 */

const SCHEME = 'recto-file'

/** The types a video or audio player needs to be told; anything else is left to the file fetch. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

/**
 * A part of a file, for a `Range: bytes=a-b` request. Video needs it: a
 * player reads the file's index first, and a movie from QuickTime or a screen
 * recording keeps that at the end - without parts, the player cannot reach it
 * and the video does not play. Null when the range is not one this answers.
 */
async function partOf(absolute: string, range: string): Promise<Response | null> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m === null) return null
  const size = (await fsp.stat(absolute)).size
  let start = m[1] === '' ? NaN : Number(m[1])
  let end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  // "bytes=-500": the last 500.
  if (Number.isNaN(start)) {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  }
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const ext = absolute.slice(absolute.lastIndexOf('.') + 1).toLowerCase()
  const body = Readable.toWeb(createReadStream(absolute, { start, end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': MEDIA_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

/** Must run before `app.whenReady()`, or the scheme has no privileges. */
export function registerVaultScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true },
    },
  ])
}

/** Must run after ready. */
export function handleVaultScheme(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'vault') return new Response('bad host', { status: 400 })

    const vault = currentVault()
    if (vault === null) return new Response('no vault', { status: 404 })

    let relative: string
    try {
      relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('bad path', { status: 400 })
    }
    if (relative === '') return new Response('bad path', { status: 400 })

    let absolute: string
    try {
      absolute = resolveInVault(vault.path, relative)
    } catch {
      return new Response('forbidden', { status: 403 })
    }

    const range = request.headers.get('Range')
    if (range !== null) {
      const part = await partOf(absolute, range).catch(() => null)
      if (part !== null) return part
    }
    return net.fetch(pathToFileURL(absolute).toString())
  })
}
