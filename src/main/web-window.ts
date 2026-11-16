import { app, BaseWindow, session, shell, WebContentsView, type Session } from 'electron'
import { IPC, type IpcApi } from '../shared/ipc'

/**
 * A web page from a canvas, opened in Recto: one window of its own, beside
 * the app (not on top of it), with back, forward, reload and "Open in
 * browser" above the page. The page lives in its own storage - sites stay
 * signed in there, apart from the app and from the browser - and gets no
 * bridge to Recto, no camera, microphone, location or notifications; a
 * download or a link that is not a web page goes to the browser.
 *
 * The bar is a page of its own with no bridge either: its buttons are links
 * to `https://bar.recto.invalid/…` - a name that is never a real site (.invalid
 * is reserved) - caught here before they go anywhere. A scheme of Recto's own
 * would not do: a link to an unknown scheme goes to the system, not here.
 */

type Handle = <C extends keyof IpcApi>(
  channel: C,
  fn: (...args: Parameters<IpcApi[C]>) => ReturnType<IpcApi[C]> | Promise<ReturnType<IpcApi[C]>>,
) => void

/** Where the pages keep their cookies and sign-ins: on disk, so they last. */
export const WEB_PARTITION = 'persist:recto-web'
const BAR = 40

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

/** What a page may ask for: full screen for a video, and writing to the clipboard when you copy. */
const ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write'])

const barPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
<style>
:root{color-scheme:light dark;--fg:#1c1c1e;--muted:#6e6e73;--bg:#f5f5f4;--line:#dcdcdc;--hover:rgba(0,0,0,.06)}
@media (prefers-color-scheme:dark){:root{--fg:#ececec;--muted:#9a9a9f;--bg:#1e1e1e;--line:#333;--hover:rgba(255,255,255,.08)}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px -apple-system,system-ui,sans-serif;overflow:hidden}
body{display:flex;align-items:center;gap:2px;padding:0 8px;box-sizing:border-box;border-bottom:1px solid var(--line)}
a{display:inline-flex;align-items:center;justify-content:center;height:28px;min-width:28px;padding:0 6px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:15px;box-sizing:border-box}
a:hover{background:var(--hover)}
a.off{opacity:.3;pointer-events:none}
#url{flex:1;min-width:0;margin:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);user-select:text}
#url b{color:var(--fg);font-weight:500}
#out{font-size:12.5px;white-space:nowrap}
</style>
<a id="back" href="https://bar.recto.invalid/back" title="Back (⌘[)">←</a>
<a id="forward" href="https://bar.recto.invalid/forward" title="Forward (⌘])">→</a>
<a id="reload" href="https://bar.recto.invalid/reload" title="Reload (⌘R)">↻</a>
<span id="url"></span>
<a id="out" href="https://bar.recto.invalid/browser" title="Open this page in your browser">Open in browser ↗</a>
<script>
function show(s){
  document.getElementById('back').className=s.back?'':'off';
  document.getElementById('forward').className=s.forward?'':'off';
  document.getElementById('reload').textContent=s.loading?'✕':'↻';
  document.getElementById('reload').href=s.loading?'https://bar.recto.invalid/stop':'https://bar.recto.invalid/reload';
  var u=document.getElementById('url');u.textContent='';
  try{var p=new URL(s.url);var b=document.createElement('b');b.textContent=p.host;u.append(b,document.createTextNode(p.pathname+p.search))}catch(e){u.textContent=s.url}
}
</script>`)}`

/**
 * The browser's own user agent, without Electron's and Recto's names in it:
 * some sites (japan.travel, behind CloudFront) turn those away with a 403.
 */
export function asBrowser(ses: Session): void {
  const names = new RegExp(` (Electron|${app.getName().replace(/[^\w-]/g, '')})/\\S+`, 'gi')
  ses.setUserAgent(ses.getUserAgent().replace(names, ''))
}

let win: BaseWindow | null = null
/** The page asked for, shown in the bar until the page has an address of its own. */
let asked = ''
let page: WebContentsView | null = null
let bar: WebContentsView | null = null

/** The pages' storage, set up once: its permissions and its downloads. */
let ready: Session | null = null
function webSession(): Session {
  if (ready !== null) return ready
  const ses = session.fromPartition(WEB_PARTITION)
  asBrowser(ses)
  ses.setPermissionRequestHandler((_c, permission, callback) => callback(ALLOWED.has(permission)))
  ses.setPermissionCheckHandler((_c, permission) => ALLOWED.has(permission))
  // A download goes to the browser, which knows where downloads go.
  ses.on('will-download', (event, item) => {
    event.preventDefault()
    if (isWeb(item.getURL())) void shell.openExternal(item.getURL())
  })
  ready = ses
  return ses
}

function layout(): void {
  if (win === null || page === null || bar === null) return
  const { width, height } = win.getContentBounds()
  bar.setBounds({ x: 0, y: 0, width, height: BAR })
  page.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) })
}

/** The bar told where the page is: its address, whether back and forward go anywhere, whether it is loading. */
function update(): void {
  if (page === null || bar === null || win === null) return
  const web = page.webContents
  const state = {
    url: web.getURL() || asked,
    back: web.navigationHistory.canGoBack(),
    forward: web.navigationHistory.canGoForward(),
    loading: web.isLoading(),
  }
  void bar.webContents.executeJavaScript(`show(${JSON.stringify(state)})`).catch(() => {})
  const title = web.getTitle()
  win.setTitle(title === '' ? state.url : title)
}

function command(what: string): void {
  const web = page?.webContents
  if (web === undefined) return
  if (what === 'back' && web.navigationHistory.canGoBack()) web.navigationHistory.goBack()
  else if (what === 'forward' && web.navigationHistory.canGoForward()) web.navigationHistory.goForward()
  else if (what === 'reload') web.reload()
  else if (what === 'stop') web.stop()
  else if (what === 'browser' && isWeb(web.getURL())) void shell.openExternal(web.getURL())
}

function open(): { page: WebContentsView } {
  if (win !== null && page !== null && !win.isDestroyed()) return { page }
  const w = new BaseWindow({ width: 1100, height: 820, minWidth: 420, minHeight: 300, show: false })
  const b = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const p = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: webSession() },
  })
  w.contentView.addChildView(b)
  w.contentView.addChildView(p)
  win = w
  bar = b
  page = p

  // The bar's buttons: caught here, never loaded.
  const caught = (event: Electron.Event, url: string): void => {
    event.preventDefault()
    const m = /^https:\/\/bar\.recto\.invalid\/(\w+)/.exec(url)
    if (m !== null) command(m[1]!)
  }
  b.webContents.on('will-navigate', caught)
  b.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void b.webContents.loadURL(barPage).then(update, () => {})

  const web = p.webContents
  // A link that opens a new window opens here instead; anything that is not a web page goes nowhere.
  web.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) void web.loadURL(url)
    return { action: 'deny' }
  })
  web.on('will-navigate', (event, url) => {
    if (!isWeb(url)) event.preventDefault()
  })
  web.on('will-redirect', (event, url) => {
    if (!isWeb(url)) event.preventDefault()
  })
  for (const e of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated'] as const)
    web.on(e as 'did-stop-loading', update)
  // Back, forward and reload by keyboard, as in a browser.
  web.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.meta || input.control)) return
    const what = input.key === '[' ? 'back' : input.key === ']' ? 'forward' : input.key.toLowerCase() === 'r' ? 'reload' : null
    if (what === null) return
    event.preventDefault()
    command(what)
  })

  w.on('resize', layout)
  w.on('closed', () => {
    win = null
    page = null
    bar = null
  })
  layout()
  return { page: p }
}

/** A web page in Recto's own window - the one already open, if any, now showing this. */
export function openWeb(url: string): { ok: true } | { ok: false; error: string } {
  if (!isWeb(url)) return { ok: false, error: 'Only web pages (http or https) open here.' }
  const { page: p } = open()
  asked = url
  void p.webContents.loadURL(url).catch(() => {})
  win!.show()
  win!.focus()
  return { ok: true }
}

export function registerWebWindow(handle: Handle): void {
  handle(IPC.webOpen, (url) => openWeb(url))
}
