import { BrowserWindow, screen, shell } from 'electron'
import { IPC, type IpcApi, type PlayerItem } from '../shared/ipc'
import { resolveInVault } from './paths'
import { currentVault } from './vault'

/**
 * The mini-player: a small window, always on top, that plays what a canvas
 * points at - a YouTube video or a video from the vault - so the canvas only
 * holds its preview. One window, reused: playing another thing replaces what
 * it plays. It is a plain sandboxed page with no bridge to Recto; a link out
 * of it goes to the browser.
 */

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

const WIDTH = 480
/** YouTube's embed refuses to play without a referrer saying where it is embedded. */
const REFERRER = 'https://recto.app/'

let player: BrowserWindow | null = null

/** Where a video from the vault is served from: the vault protocol, as the canvas loads it. */
const fileUrl = (relative: string): string =>
  `recto-file://vault/${relative.split('/').map(encodeURIComponent).join('/')}`

/** A page with only the video in it. */
const videoPage = (src: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain;display:block}</style><video src="${src}" controls autoplay></video>`,
  )}`

function open(): BrowserWindow {
  if (player !== null && !player.isDestroyed()) return player
  const area = screen.getPrimaryDisplay().workArea
  const height = Math.round((WIDTH * 9) / 16)
  const win = new BrowserWindow({
    width: WIDTH,
    height,
    // Bottom right, out of the way, as a picture-in-picture player sits.
    x: area.x + area.width - WIDTH - 24,
    y: area.y + area.height - height - 24,
    minWidth: 240,
    minHeight: 135,
    alwaysOnTop: true,
    fullscreenable: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Nothing opens in-app from the player: out to the browser, or nowhere.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  win.on('closed', () => {
    player = null
  })
  player = win
  return win
}

export function play(item: PlayerItem): { ok: true } | { ok: false; error: string } {
  if (item.kind === 'file') {
    const vault = currentVault()
    if (vault === null) return { ok: false, error: 'No vault is open.' }
    try {
      resolveInVault(vault.path, item.path)
    } catch {
      return { ok: false, error: 'That file is not in the vault.' }
    }
  } else if (!/^[\w-]{11}$/.test(item.id)) return { ok: false, error: 'That is not a YouTube video.' }

  const win = open()
  win.setTitle(item.title)
  const ratio = item.ratio !== undefined && item.ratio > 0 ? item.ratio : 16 / 9
  win.setAspectRatio(ratio)
  const [width] = win.getSize()
  win.setSize(width ?? WIDTH, Math.round((width ?? WIDTH) / ratio))
  const load =
    item.kind === 'youtube'
      ? win.loadURL(`https://www.youtube-nocookie.com/embed/${item.id}?autoplay=1&rel=0`, { httpReferrer: REFERRER })
      : win.loadURL(videoPage(fileUrl(item.path)))
  void load.catch(() => {})
  win.show()
  return { ok: true }
}

export function registerPlayer(handle: Handle): void {
  handle(IPC.playerOpen, (item) => play(item))
}
