/** The video id of a YouTube link (watch, youtu.be, shorts, embed), or null. */
export function youTubeId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url.trim())
  return m?.[1] ?? null
}
