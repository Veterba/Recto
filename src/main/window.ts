import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAppUrl } from './navigation'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** The renderer's own entry point, dev server or built file. */
function appEntry(): string {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  return devServer ?? pathToFileURL(path.join(dirname, '../renderer/index.html')).href
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 680,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    /**
     * Vibrancy: the desktop behind the window is blurred through it.
     *
     * `under-window` blurs everything behind the whole window rather than
     * tinting a region, which is the effect asked for. It only works if the
     * window itself paints nothing opaque - hence the fully transparent
     * background here, and translucent surface tokens in the renderer. If the
     * user turns translucency off, the renderer paints opaque backgrounds over
     * the top and the vibrancy is simply never seen.
     *
     * macOS only. On Windows and Linux these are ignored and the opaque
     * backgrounds are all there is, which is the correct fallback.
     */
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  // Nothing navigates away from the bundle, and nothing opens a window in-app.
  // External http(s) links go to the real browser; everything else is dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    // A reload is a navigation to our own URL. Blocking it indiscriminately
    // breaks reload in production, so allow anything that stays in the app.
    if (isAppUrl(url, appEntry())) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  /**
   * Full screen turns the translucency off.
   *
   * In full screen there is no desktop behind the window to blur - the backdrop
   * is whatever macOS puts behind a full-screen space, which is black. A
   * "translucent" sidebar there is just a darker sidebar with less contrast, so
   * the renderer switches to the opaque palette while it lasts.
   */
  const pushFullScreen = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send('app:fullscreen', win.isFullScreen())
  }
  win.on('enter-full-screen', pushFullScreen)
  win.on('leave-full-screen', pushFullScreen)

  win.once('ready-to-show', () => win.show())

  void win.loadURL(appEntry())

  return win
}
