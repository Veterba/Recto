import { BrowserWindow, session, type NativeImage, type Session } from 'electron'
import type { LinkPreview } from '../shared/canvas'
import { publicUrl } from './public-url'
import { asBrowser } from './web-window'
import { blankRows } from './picture-checks'

/**
 * A link's preview read from the page as a browser shows it - for the many
 * pages a plain fetch gets nothing from: a consent wall, a page its scripts
 * build, a site that turns away anything but a browser. The page is loaded in
 * a hidden window with its sound off, in storage of its own that keeps
 * nothing past Recto quitting and allows nothing (no camera, location,
 * notifications); every request it makes must go to the public web, so a page
 * cannot reach this Mac or its network. Its title, description and icon are
 * read; with no real picture of its own, the top of the page is the picture,
 * what covers it (a cookie banner, a sign-up box) out of the way. One at a
 * time; null when the page would not load.
 */

const WIDTH = 1280
/** Taller than the picture (16:9 of the width): room to leave out a blank top. */
const HEIGHT = 1080
/** A card's picture's width: sharp on a card zoomed in on a Retina screen, small enough to keep. */
const PICTURE_WIDTH = 1000

/** A picture as the card keeps it: a JPEG no wider than it needs to be. */
export function asJpeg(image: NativeImage): string {
  const sized = image.getSize().width > PICTURE_WIDTH ? image.resize({ width: PICTURE_WIDTH, quality: 'best' }) : image
  return `data:image/jpeg;base64,${sized.toJPEG(82).toString('base64')}`
}
const LOAD_MS = 12_000
/** After it has loaded, a moment for what its scripts draw. */
const SETTLE_MS = 1200

let ready: Session | null = null
function previewSession(): Session {
  if (ready !== null) return ready
  // No `persist:`: nothing it stores outlives Recto.
  const ses = session.fromPartition('recto-preview')
  asBrowser(ses)
  ses.setPermissionRequestHandler((_c, _p, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  const checked = new Map<string, boolean>()
  ses.webRequest.onBeforeRequest((details, callback) => {
    let url: URL
    try {
      url = new URL(details.url.replace(/^ws/, 'http'))
    } catch {
      return callback({ cancel: true })
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return callback({})
    const known = checked.get(url.host)
    if (known !== undefined) return callback({ cancel: !known })
    void publicUrl(url).then((ok) => {
      checked.set(url.host, ok)
      callback({ cancel: !ok })
    })
  })
  ready = ses
  return ses
}

/** A consent or cookie wall in front of the page: not its preview. */
const walled = (host: string, title: string): boolean =>
  /^consent\./.test(host) || /before you continue|cookie|consent|accept all|privacy choices/i.test(title)

type Read = { title: string; description: string | null; image: string | null; icon: string | null; host: string }

const READ = `(() => {
  const meta = (k) => document.querySelector('meta[property="' + k + '"], meta[name="' + k + '"]')?.content?.trim() || null
  const icon = document.querySelector('link[rel~="icon"]')?.href || null
  return { title: meta('og:title') || document.title || '', description: meta('og:description') || meta('description'), image: meta('og:image'), icon, host: location.host }
})()`

/**
 * What covers the page rather than being it, out of the picture: cookie and
 * consent banners, sign-up boxes, chat bubbles - whatever stays fixed on the
 * screen, except a bar across its top (the site's own header) - and dialogs;
 * and the page let scroll again, as such a box stops it.
 */
const UNCOVER = `(() => {
  const hide = (el) => el.style.setProperty('display', 'none', 'important')
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot)
      const s = getComputedStyle(el)
      if (s.position !== 'fixed' && s.position !== 'sticky') continue
      const r = el.getBoundingClientRect()
      const header = r.top <= 1 && r.height < innerHeight * 0.2 && r.width > innerWidth * 0.6
      if (!header) hide(el)
    }
    for (const el of root.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')) hide(el)
  }
  walk(document)
  for (const el of [document.documentElement, document.body]) if (el) el.style.setProperty('overflow', 'auto', 'important')
})()`

/** How far down a screenshot starts to show something, a few pixels above it (picture-checks.ts). */
function blankTop(shot: NativeImage): number {
  const small = shot.resize({ width: 64 })
  const { width, height } = small.getSize()
  const rows = blankRows(small.toBitmap(), width, height)
  return Math.max(0, Math.round((rows * shot.getSize().height) / height) - 8)
}

let turn: Promise<unknown> = Promise.resolve()

type Fetch = (src: string | null, base: string) => Promise<string | null>

/** `cover` reads the page's own picture (null when it is no real one); `picture`, its icon. */
export function renderedPreview(url: string, cover: Fetch, picture: Fetch): Promise<LinkPreview | null> {
  const run = turn.then(() => render(url, cover, picture))
  turn = run.catch(() => undefined)
  return run
}

async function render(url: string, cover: Fetch, picture: Fetch): Promise<LinkPreview | null> {
  if (!(await publicUrl(new URL(url)))) return null
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, session: previewSession() },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const loaded = win.loadURL(url).then(
      () => true,
      () => false,
    )
    const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LOAD_MS))
    // Slow to finish (a page that never stops loading): what it shows by then is the preview.
    if (!(await Promise.race([loaded, timedOut])) && win.webContents.getURL() === '') return null
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    const read = (await win.webContents.executeJavaScript(READ)) as Read
    if (walled(read.host, read.title)) return null
    const base = win.webContents.getURL()
    let image = await cover(read.image, base)
    if (image === null) {
      await win.webContents.executeJavaScript(UNCOVER).catch(() => undefined)
      // A frame drawn without what was hidden.
      await new Promise((resolve) => setTimeout(resolve, 200))
      const page = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT })
      if (page.isEmpty()) image = null
      else {
        const { width, height } = page.getSize()
        const tall = Math.round((width * 9) / 16)
        const top = Math.min(blankTop(page), height - tall)
        image = asJpeg(page.crop({ x: 0, y: top, width, height: tall }))
      }
    }
    return {
      title: read.title.trim() === '' ? null : read.title.trim(),
      description: read.description,
      image,
      icon: await picture(read.icon, base),
    }
  } catch (err) {
    console.error('[link preview]', err)
    return null
  } finally {
    win.destroy()
  }
}
