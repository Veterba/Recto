/**
 * Pictures and videos in a chat message. One pasted or dropped into a chat is
 * put in the vault's attachments folder, as one pasted into a note is, and the
 * message embeds it as Obsidian would - `![[shot.png]]` or `![](clip.mp4)` -
 * so the topic note shows it in Obsidian too. What a model is sent is read
 * from those embeds when the message goes (main/chat-pictures.ts): a picture
 * as it is, a video as frames of it.
 */

/** The picture files a chat may send. */
export const PICTURE_FILE = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i
/** The video files a chat may send (as frames): the ones this Mac's Chromium plays. */
export const VIDEO_FILE = /\.(mp4|m4v|mov|webm|ogv)$/i

/** One embedded picture or video: the embed as written, the file it names (a link name or a path), which it is. */
export type PictureRef = { raw: string; target: string; kind: 'picture' | 'video' }

const kindOf = (target: string): PictureRef['kind'] | null => (PICTURE_FILE.test(target) ? 'picture' : VIDEO_FILE.test(target) ? 'video' : null)

const WIKI = /!\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g
const MARKDOWN = /!\[[^\]\n]*\]\(<?([^)>\n]+?)>?(?:\s+"[^"\n]*")?\)/g

/** The pictures and videos a message embeds, in the order they are written. A web address is not one of the vault's. */
export function pictureRefs(text: string): PictureRef[] {
  const found: { at: number; ref: PictureRef }[] = []
  for (const m of text.matchAll(WIKI)) {
    const target = m[1]!.trim()
    const kind = kindOf(target)
    if (kind !== null) found.push({ at: m.index, ref: { raw: m[0], target, kind } })
  }
  for (const m of text.matchAll(MARKDOWN)) {
    let target = m[1]!.trim()
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    try {
      target = decodeURI(target)
    } catch {
      // A stray '%': the path as written.
    }
    const kind = kindOf(target)
    if (kind !== null) found.push({ at: m.index, ref: { raw: m[0], target, kind } })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.ref)
}

/** The message's text with its pictures and videos taken out: what a bubble shows beside them. */
export function withoutPictures(text: string): string {
  const refs = pictureRefs(text)
  if (refs.length === 0) return text
  let out = text
  for (const ref of refs) out = out.replace(ref.raw, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** A message with pictures added after its text, one embed a line. */
export function withPictureEmbeds(text: string, embeds: readonly string[]): string {
  const body = text.trim()
  if (embeds.length === 0) return body
  return body === '' ? embeds.join('\n') : `${body}\n\n${embeds.join('\n')}`
}
