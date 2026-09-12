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
    backgroundColor: '#16161a',
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

  win.once('ready-to-show', () => win.show())

  void win.loadURL(appEntry())

  return win
}
