import { BrowserWindow } from 'electron'
import type { AiImage } from '../shared/ai'

/**
 * Frames of a vault video, for a model that sees pictures but not videos
 * (none of Recto's providers takes a video): four a second, up to `count`
 * spread over all of it, each with its time - enough for motion to show from
 * one to the next. Shown in a hidden window that never appears - its own
 * page, the video loaded from the vault scheme, the sound off - and the
 * window's picture taken at each time; then closed.
 * One at a time; null when the video cannot be read.
 */

/** A frame's long side at most: enough to see what happens, light enough to send dozens. */
const LONG_SIDE = 800
/** Frames a second of video, until `count` would be passed; a longer video's frames are spread over all of it. */
const PER_SECOND = 4
/** For the whole video: a slow one gives the frames it has by then. */
const TIMEOUT_MS = 30_000

export type VideoFrames = { duration: number; frames: { at: number; image: AiImage }[] }

let turn: Promise<unknown> = Promise.resolve()

export function videoFrames(url: string, count: number): Promise<VideoFrames | null> {
  const run = turn.then(() => grab(url, count))
  turn = run.catch(() => undefined)
  return run
}

/**
 * In the page: the video's length and size, once it knows them. A WebM a
 * browser recorded says no length: playing it to its end, as far as the
 * player is concerned, tells it.
 */
const META = `new Promise((ok) => {
  const v = document.querySelector('video')
  const done = () => ok(isFinite(v.duration) && v.duration > 0 && v.videoWidth > 0 ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : { error: 'no picture' })
  const known = () => {
    if (v.duration !== Infinity) return done()
    v.ondurationchange = () => {
      if (!isFinite(v.duration)) return
      v.ondurationchange = null
      done()
    }
    v.currentTime = 1e101
  }
  if (v.readyState >= 1) return known()
  v.onloadedmetadata = known
  v.onerror = () => ok({ error: 'unreadable: ' + (v.error ? v.error.code + ' ' + v.error.message : '') })
})`

/** In the page: to a time, and on until that frame is drawn. */
const SEEK = (at: number): string => `new Promise((ok) => {
  const v = document.querySelector('video')
  v.onseeked = () => requestAnimationFrame(() => requestAnimationFrame(() => ok(true)))
  v.currentTime = ${at}
})`

/**
 * The frames are the window's own picture (capturePage), not a canvas's: a
 * canvas that drew a video from the vault scheme may not be read back (it is
 * another origin to the page), and the window's picture has no such rule.
 */
async function grab(url: string, count: number): Promise<VideoFrames | null> {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    useContentSize: true,
    backgroundColor: '#000000',
    // Web security off: a `data:` page may not load from the vault scheme otherwise. The page is Recto's own,
    // with nothing in it but the vault's video, and it goes nowhere (navigation and new windows refused).
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: false },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  const until = Date.now() + TIMEOUT_MS
  const inTime = <T,>(work: Promise<T>): Promise<T | null> =>
    Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, until - Date.now())))])
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block}</style><video muted preload="auto" src="${url.replace(/"/g, '&quot;')}"></video>`,
      )}`,
    )
    const meta = (await inTime(win.webContents.executeJavaScript(META))) as { duration: number; width: number; height: number } | { error: string } | null
    if (meta === null || 'error' in meta) {
      if (meta !== null) console.error('[video frames]', meta.error)
      return null
    }
    const scale = Math.min(1, LONG_SIDE / Math.max(meta.width, meta.height))
    win.setContentSize(Math.max(2, Math.round(meta.width * scale)), Math.max(2, Math.round(meta.height * scale)))
    // Densely enough to see motion: PER_SECOND a second, at most `count`, spread over the whole video.
    const n = Math.max(1, Math.min(count, Math.ceil(meta.duration * PER_SECOND)))
    const frames: VideoFrames['frames'] = []
    for (let i = 0; i < n; i++) {
      const at = (meta.duration * (i + 0.5)) / n
      if ((await inTime(win.webContents.executeJavaScript(SEEK(at)))) === null) break
      const shot = await win.webContents.capturePage()
      if (shot.isEmpty()) continue
      frames.push({ at, image: { mime: 'image/jpeg', data: shot.toJPEG(75).toString('base64') } })
    }
    return frames.length === 0 ? null : { duration: meta.duration, frames }
  } catch (err) {
    console.error('[video frames]', err)
    return null
  } finally {
    win.destroy()
  }
}
