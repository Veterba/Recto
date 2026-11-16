/** The video id of a YouTube link (watch, youtu.be, shorts, embed), or null. */
export function youTubeId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url.trim())
  return m?.[1] ?? null
}

/** The video id of a Vimeo link (vimeo.com/123…, player.vimeo.com/video/123…), or null. */
export function vimeoId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:[/?#]|$)/.exec(url.trim())
  return m?.[1] ?? null
}
