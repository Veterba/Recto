import { nativeImage } from 'electron'
import type { AiImage, AiMessage } from '../shared/ai'
import { pictureRefs } from '../shared/chat-pictures'
import { resolveLinkpath } from '../shared/obsidian-links'
import { currentLinkVault } from './link-context'
import * as vaultFs from './vault-fs'
import { videoFrames, type VideoFrames } from './video-frames'

/**
 * The pictures and videos a conversation's messages embed, read from the
 * vault as it is sent: each person's message gets its own, in the order it
 * shows them, the newest messages first up to `MAX_PICTURES` pictures and
 * `MAX_VIDEOS` videos - older ones stay as their names. No provider takes a
 * video, so a video goes as frames spread over it (video-frames.ts). In the
 * text each embed becomes `[picture N: name]`, or for a video what it is and
 * the times of its frames, so a model that gets the text alone (a CLI's
 * transcript) still knows where each one was and which pictures are which.
 * A picture is the person's own, put there on purpose: it goes whatever the
 * folder (excluded folders hold for what AI reads by itself, not for this).
 */

/** At most this many pictures go with one question, the newest first. */
export const MAX_PICTURES = 8
/**
 * At most this many videos, the newest first, each as this many frames at most (four a second up to it,
 * video-frames.ts). With the pictures, under the 100 pictures Claude takes in one request.
 */
export const MAX_VIDEOS = 2
export const FRAMES_PER_VIDEO = 40
/** Longer than this on its long side, a picture is made smaller: what models read at most, in effect. */
const LONG_SIDE = 1600
/** A picture sent as it is: one of these types, at most this big. */
const AS_IS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const AS_IS_BYTES = 4 * 1024 * 1024

export type PictureDeps = {
  /** The vault path an embed names (the composer writes them from the vault's root), or null. */
  resolve: (target: string) => string | null
  read: (path: string) => Promise<Uint8Array | null>
  /** The bytes as a model takes them; null when they are no picture this Mac can read. */
  prepare: (bytes: Uint8Array, path: string) => AiImage | null
  /** A video's frames, spread over it; null when it cannot be read. */
  frames: (path: string, count: number) => Promise<VideoFrames | null>
}

/** A time in a video as a person reads it: 0:05, 1:24, 1:02:03 - with tenths, 0:01.3. */
export const clock = (seconds: number, tenths = false): string => {
  const whole = Math.max(0, tenths ? Math.floor(seconds) : Math.round(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  const tenth = tenths ? `.${Math.min(9, Math.floor((Math.max(0, seconds) - whole) * 10))}` : ''
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}${tenth}` : `${m}:${s}${tenth}`
}

/** What a video's frames are, for the model: which pictures, in what order, from when. */
export function framesSaid(name: string, duration: number, ats: readonly number[], first: number): string {
  const n = ats.length
  const which = n === 1 ? `picture ${first}` : `pictures ${first}-${first + n - 1}`
  const fine = duration < 60
  const times =
    n <= 8
      ? `at ${ats.map((t) => clock(t, fine)).join(', ')}`
      : `one every ${Number((duration / n).toFixed(2))} s from ${clock(ats[0]!, fine)} to ${clock(ats.at(-1)!, fine)}`
  return `[video: ${name}, ${clock(duration, fine)} long - sent as ${n} frame${n === 1 ? '' : 's'} in order (${which}), ${times}; together they show what happens in it]`
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The conversation with its pictures (shared/ai.ts `images`); one without any is given back as it is. */
export async function withPictures(messages: AiMessage[], deps: PictureDeps = electronDeps): Promise<AiMessage[]> {
  let left = MAX_PICTURES
  let videos = MAX_VIDEOS
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i]!
    if (message.role !== 'user') continue
    const refs = pictureRefs(message.content)
    if (refs.length === 0) continue
    let content = message.content
    const images: AiImage[] = []
    for (const ref of refs) {
      const path = deps.resolve(ref.target)
      const name = nameOf(path ?? ref.target)
      if (ref.kind === 'video') {
        const got = videos > 0 && path !== null ? await deps.frames(path, FRAMES_PER_VIDEO).catch(() => null) : null
        if (got === null || got.frames.length === 0) {
          content = content.replace(ref.raw, videos > 0 ? `[video ${name}: could not be read]` : `[video ${name}: sent earlier]`)
          continue
        }
        videos--
        const first = images.length + 1
        images.push(...got.frames.map((f) => f.image))
        content = content.replace(ref.raw, framesSaid(name, got.duration, got.frames.map((f) => f.at), first))
        continue
      }
      let image: AiImage | null = null
      if (left > 0 && path !== null) {
        const bytes = await deps.read(path).catch(() => null)
        image = bytes === null ? null : deps.prepare(bytes, path)
      }
      if (image !== null) {
        images.push(image)
        left--
        content = content.replace(ref.raw, `[picture ${images.length}: ${name}]`)
      } else content = content.replace(ref.raw, left > 0 ? `[picture ${name}: could not be read]` : `[picture ${name}: sent earlier]`)
    }
    out[i] = images.length > 0 ? { ...message, content, images } : { ...message, content }
  }
  return out
}

/** Whether the question - the last thing the person said - has a picture or a video in it. */
export const asksWithPicture = (messages: readonly AiMessage[]): boolean => {
  const last = messages.findLast((m) => m.role === 'user')
  return last !== undefined && pictureRefs(last.content).length > 0
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** A picture as a model takes it: as it is when it can, else a JPEG this Mac drew from it, smaller if big. */
export function preparePicture(bytes: Uint8Array, path: string): AiImage | null {
  const mime = MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]
  const buffer = Buffer.from(bytes)
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) {
    // Not one this Mac draws (an animated GIF or a WebP may not be): sent as it is when a model takes the type.
    return mime !== undefined && AS_IS.has(mime) && buffer.byteLength <= AS_IS_BYTES ? { mime, data: buffer.toString('base64') } : null
  }
  const { width, height } = image.getSize()
  const long = Math.max(width, height)
  if (long <= LONG_SIDE && mime !== undefined && AS_IS.has(mime) && buffer.byteLength <= AS_IS_BYTES) return { mime, data: buffer.toString('base64') }
  const sized = long > LONG_SIDE ? image.resize(width >= height ? { width: LONG_SIDE, quality: 'best' } : { height: LONG_SIDE, quality: 'best' }) : image
  return { mime: 'image/jpeg', data: sized.toJPEG(85).toString('base64') }
}

const electronDeps: PictureDeps = {
  frames: (path, count) => videoFrames(`recto-file://vault/${path.split('/').map(encodeURIComponent).join('/')}`, count),
  resolve: (target) => {
    if (target.includes('/')) return target.replace(/^\.?\//, '')
    return resolveLinkpath(target, '', currentLinkVault())
  },
  read: async (path) => {
    const read = await vaultFs.readBytes(path)
    return read.ok ? read.data : null
  },
  prepare: preparePicture,
}
