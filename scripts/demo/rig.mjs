// The recording rig: starts the app on a throwaway copy of the demo vault, moves
// a fake cursor like a person would, and films the window.
//
// Every run works on a fresh copy named "Notes" with a new profile, so a shot
// starts from the same state however it left the last one.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'
import { AI_TAPE, DEMO_NOW, ROOT, RUN_VAULT, VAULT } from './paths.mjs'

export const WIDTH = 1600
export const HEIGHT = 1000
const SCALE = 2
const FPS = 30
const WINDOW_AT = [40, 40]
/** A still moment at either end of a shot. */
const CALM_MS = 600

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A seeded generator (mulberry32): the same rhythm and curves every run. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Runs in the page before anything else: the demo's clock, fixed randomness, the desktop behind the glass, the cursor. */
function pageSetup({ now, width }) {
  const RealDate = Date
  const offset = now - RealDate.now()
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...args)
    }
    static now() {
      return RealDate.now() + offset
    }
  }
  let seed = 0x2f6b
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const install = () => {
    if (document.getElementById('demo-cursor')) return
    const style = document.createElement('style')
    // Vibrancy is drawn by macOS, outside the page, so a capture of the page
    // has nothing behind the glass. This stands in for a blurred wallpaper.
    style.textContent = `
      html { background: radial-gradient(120% 90% at 10% 0%, #b9c7d6 0%, #94a7bb 45%, #7d8fa6 100%) !important; }
      * { scrollbar-width: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      * { cursor: none !important; }
      #demo-lights { position: fixed; left: 13px; top: 9px; display: flex; gap: 8px; z-index: 2147483646; pointer-events: none; }
      #demo-lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.18); }
      #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none; will-change: transform;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      #demo-cursor svg { transition: transform 90ms ease-out; transform-origin: 5px 3px; }
      #demo-cursor.is-down svg { transform: scale(.88); }
      #demo-pulse { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; z-index: 2147483646; pointer-events: none;
        background: rgba(60, 110, 220, .22); box-shadow: 0 0 0 1.5px rgba(60, 110, 220, .35); opacity: 0; }
      #demo-pulse.go { animation: demo-pulse 420ms ease-out; }
      @keyframes demo-pulse { from { opacity: 1; scale: .4; } to { opacity: 0; scale: 1.25; } }
      #demo-ghost { position: fixed; left: 0; top: 0; z-index: 2147483645; pointer-events: none; padding: 5px 10px; border-radius: 6px; font: 500 13px -apple-system, sans-serif;
        background: rgba(255,255,255,.92); color: #2f3437; box-shadow: 0 4px 14px rgba(0,0,0,.22); display: none; }
    `
    document.head.append(style)
    const lights = document.createElement('div')
    lights.id = 'demo-lights'
    lights.innerHTML = '<i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>'
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 2.6 L5 20.4 L9.4 16.3 L12.1 22.6 L15.3 21.2 L12.6 15.1 L18.6 15.1 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`
    const pulse = document.createElement('div')
    pulse.id = 'demo-pulse'
    const ghost = document.createElement('div')
    ghost.id = 'demo-ghost'
    document.documentElement.append(lights, pulse, ghost, cursor)
    // The arrow's tip is at (5, 3) in its box.
    const place = (x, y) => {
      window.__demoAt = [x, y]
      cursor.style.transform = `translate(${x - 5}px, ${y - 3}px)`
      ghost.style.transform = `translate(${x + 12}px, ${y + 10}px)`
    }
    const follow = (e) => place(e.clientX, e.clientY)
    for (const type of ['mousemove', 'pointermove', 'dragover', 'drag']) window.addEventListener(type, follow, true)
    window.__demoPlace = place
    window.__demoPress = (down) => cursor.classList.toggle('is-down', down)
    window.__demoPulse = (x, y) => {
      pulse.style.left = `${x}px`
      pulse.style.top = `${y}px`
      pulse.classList.remove('go')
      void pulse.offsetWidth
      pulse.classList.add('go')
    }
    window.__demoGhost = (text) => {
      ghost.textContent = text ?? ''
      ghost.style.display = text ? 'block' : 'none'
    }
    place(...(window.__demoStart ?? [width - 160, 180]))
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install)
  else install()
}

/** Time in Recto, for the overview: it lives in the profile, which a shot starts fresh. */
function demoUsage() {
  const random = seeded(45)
  const active = {}
  for (let back = 120; back >= 1; back--) {
    const day = new Date(DEMO_NOW.getTime() - back * 86_400_000).toLocaleDateString('sv')
    if (random() < 0.8) active[day] = Math.round(900 + random() * 2700)
  }
  return { active, activeSince: Object.keys(active)[0], opened: {} }
}

/**
 * A copy of the vault for one shot. At a fixed, neutral path because the home
 * page prints the vault's path, and a temp folder's would carry this Mac's id.
 * Only ever replaces a copy of its own, known by the mark inside.
 */
function freshCopy() {
  const mark = path.join(RUN_VAULT, '.recto', 'demo-copy')
  if (fs.existsSync(RUN_VAULT) && !fs.existsSync(mark))
    throw new Error(`${RUN_VAULT} exists and is not a demo copy. Move it, then run again.`)
  fs.rmSync(RUN_VAULT, { recursive: true, force: true })
  fs.cpSync(VAULT, RUN_VAULT, { recursive: true, preserveTimestamps: true })
  fs.writeFileSync(mark, '')
  return RUN_VAULT
}

/**
 * The app, on a fresh copy of the vault. `firstRun`: open on "Choose a vault",
 * with the picker answering the copy. `ai`: 'replay' or 'record' for the local model.
 */
export async function openApp({ firstRun = false, ai = 'replay', tapeFrom = 0, mutate } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-demo-'))
  const vault = freshCopy()
  const profile = path.join(base, 'profile')
  mutate?.(vault)
  fs.mkdirSync(profile)
  if (!firstRun) fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
  fs.writeFileSync(path.join(profile, 'overview-usage.json'), JSON.stringify(demoUsage()))
  const models = path.join(os.homedir(), 'Library/Application Support/Recto/models')
  const app = await _electron.launch({
    args: ['-r', path.join(ROOT, 'scripts/demo/demo-main.cjs'), ROOT, `--user-data-dir=${profile}`, `--force-device-scale-factor=${SCALE}`],
    env: {
      ...process.env,
      RECTO_ALLOW_REAL_VAULT: '1',
      RECTO_CLI_DIRS: '/nonexistent',
      ...(fs.existsSync(models) ? { RECTO_MODEL_DIR: models } : {}),
      DEMO_NOW: DEMO_NOW.toISOString(),
      DEMO_PICK: vault,
      DEMO_AI: ai,
      DEMO_TAPE: AI_TAPE,
      DEMO_TAPE_FROM: String(tapeFrom),
    },
  })
  const page = await app.firstWindow()
  await app.evaluate(
    ({ BrowserWindow }, { w, h, at }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(w, h)
      win.setPosition(at[0], at[1])
      win.webContents.setBackgroundThrottling(false)
    },
    { w: WIDTH, h: HEIGHT, at: WINDOW_AT },
  )
  await page.addInitScript(pageSetup, { now: DEMO_NOW.getTime(), width: WIDTH })
  await page.reload()
  await page.waitForSelector(firstRun ? '.firstrun' : '[role=treeitem]', { timeout: 60_000 })
  await page.waitForFunction(() => document.getElementById('demo-cursor') !== null)
  await waitCalm(page)
  const close = async () => {
    const child = app.process()
    await Promise.race([app.close().catch(() => undefined), sleep(10_000)])
    child.kill('SIGKILL')
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    fs.rmSync(vault, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
  return { app, page, vault, close }
}

/** Until nothing on the page is animating and the DOM has been quiet for a moment. */
export async function waitCalm(page, quietMs = 250) {
  await page.waitForFunction(
    (quiet) =>
      new Promise((resolve) => {
        let last = performance.now()
        // The bot breathes and the home page's field drifts for ever: not a sign the UI is busy.
        const idle = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest('.floating-bot, .cm-cursorLayer, .home__window')
        const observer = new MutationObserver((list) => {
          if (list.some((m) => !idle(m.target))) last = performance.now()
        })
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
        const started = performance.now()
        const check = () => {
          const busy = document
            .getAnimations()
            .some(
              (a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity && !idle(a.effect?.target ?? document.body),
            )
          if (busy) last = performance.now()
          if (performance.now() - last >= quiet) return (observer.disconnect(), resolve(true))
          if (performance.now() - started > 6000) return (observer.disconnect(), resolve(true))
          // Not requestAnimationFrame: a hidden window draws nothing while nothing changes.
          setTimeout(check, 30)
        }
        check()
      }),
    quietMs,
    { polling: 100, timeout: 15_000 },
  )
}

/** The hand on the mouse and keyboard. */
export class Stage {
  constructor(page, seed) {
    this.page = page
    this.random = seeded(seed)
    this.at = [WIDTH - 160, 180]
  }

  /** Puts the cursor somewhere before filming starts. */
  async place(x, y) {
    this.at = [x, y]
    await this.page.mouse.move(x, y)
    await this.page.evaluate(([px, py]) => window.__demoPlace(px, py), [x, y])
  }

  /** Eased, slightly curved, 500-800 ms. */
  async move(x, y, ms) {
    const [x0, y0] = this.at
    const duration = ms ?? 500 + this.random() * 300
    const bend = (this.random() - 0.5) * 0.16 * Math.hypot(x - x0, y - y0)
    const length = Math.hypot(x - x0, y - y0) || 1
    const cx = (x0 + x) / 2 + (-(y - y0) / length) * bend
    const cy = (y0 + y) / 2 + ((x - x0) / length) * bend
    const started = Date.now()
    for (;;) {
      const t = Math.min(1, (Date.now() - started) / duration)
      const e = easeInOut(t)
      const px = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e ** 2 * x
      const py = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e ** 2 * y
      await this.page.mouse.move(px, py)
      if (t === 1) break
      await sleep(12)
    }
    this.at = [x, y]
  }

  /** Where a locator's centre is, once it is on screen and has stopped moving. */
  async centre(target, { dx = 0, dy = 0 } = {}) {
    const locator = typeof target === 'string' ? this.page.locator(target).first() : target
    await locator.waitFor({ state: 'visible', timeout: 15_000 })
    let box = await locator.boundingBox()
    for (let i = 0; i < 30; i++) {
      await sleep(40)
      const next = await locator.boundingBox()
      if (next.x === box.x && next.y === box.y) break
      box = next
    }
    return [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy]
  }

  async hover(target, options) {
    const [x, y] = await this.centre(target, options)
    await this.move(x, y)
  }

  /** A pause, a pulse, a click. */
  async click(target, { button = 'left', ...options } = {}) {
    if (target !== null) await this.hover(target, options)
    const [x, y] = this.at
    await sleep(300)
    await this.page.evaluate(([px, py]) => (window.__demoPress(true), window.__demoPulse(px, py)), [x, y])
    await this.page.mouse.down({ button })
    await sleep(70)
    await this.page.mouse.up({ button })
    await this.page.evaluate(() => window.__demoPress(false))
  }

  /** Press at `from`, travel to `to`, let go. `ghost`: a label under the cursor, for drags whose native image cannot be filmed. */
  async drag(from, to, { ghost, ms = 800 } = {}) {
    const start = Array.isArray(from) ? from : await this.centre(from)
    await this.move(...start)
    await sleep(300)
    await this.page.evaluate(() => window.__demoPress(true))
    await this.page.mouse.down()
    await sleep(120)
    if (ghost) await this.page.evaluate((text) => window.__demoGhost(text), ghost)
    // A small first step, as a hand makes: it is what starts a drag.
    await this.move(start[0] + 8, start[1] + 6, 120)
    const end = Array.isArray(to) ? to : await this.centre(to)
    await this.move(end[0], end[1], ms)
    await sleep(220)
    await this.page.mouse.up()
    await this.page.evaluate(() => (window.__demoPress(false), window.__demoGhost(null)))
  }

  /** 40-90 ms a key, from the seed; a little longer after a word. */
  async type(text) {
    for (const char of text) {
      await this.page.keyboard.type(char)
      await sleep(40 + this.random() * 50 + (char === ' ' ? 40 : 0))
    }
  }

  async press(combo) {
    await this.page.keyboard.press(combo)
  }

  /** A steady scroll by the clock, however long each wheel event takes. */
  async scrollOver(target, deltaY, ms) {
    await this.hover(target)
    const started = Date.now()
    let done = 0
    for (;;) {
      const t = Math.min(1, (Date.now() - started) / ms)
      const to = deltaY * easeInOut(t)
      await this.page.mouse.wheel(0, to - done)
      done = to
      if (t === 1) break
      await sleep(16)
    }
  }
}

/** Films the page over the DevTools protocol: every frame the compositor draws, at full pixel size, with its time. */
export class Film {
  constructor(page, dir) {
    this.page = page
    this.dir = dir
    this.frames = []
    this.writes = []
  }

  async start() {
    fs.mkdirSync(this.dir, { recursive: true })
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', (frame) => {
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`)
      this.frames.push({ file, time: frame.metadata.timestamp })
      this.writes.push(fs.promises.writeFile(file, Buffer.from(frame.data, 'base64')))
      this.cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
    })
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 94,
      maxWidth: WIDTH * SCALE,
      maxHeight: HEIGHT * SCALE,
      everyNthFrame: 2,
    })
    // The first frame only comes with a change: a 1px nudge outside the picture's content.
    await this.page.evaluate(() => {
      const el = document.getElementById('demo-lights')
      el.style.opacity = '0.999'
      requestAnimationFrame(() => (el.style.opacity = ''))
    })
    while (this.frames.length === 0) await sleep(10)
    await sleep(CALM_MS)
  }

  async stop() {
    await waitCalm(this.page)
    await sleep(CALM_MS)
    this.end = Date.now() / 1000
    await this.cdp.send('Page.stopScreencast')
    await Promise.all(this.writes)
  }

  /** One frame per 1/30 s tick, the latest drawn by then, so motion keeps its real timing; then H.264. */
  encode(out) {
    const ticks = path.join(this.dir, 'ticks')
    fs.mkdirSync(ticks)
    const start = this.frames[0].time
    let at = 0
    for (let tick = 0; tick / FPS <= this.end - start; tick++) {
      while (this.frames[at + 1] !== undefined && this.frames[at + 1].time - start <= tick / FPS) at++
      fs.linkSync(this.frames[at].file, path.join(ticks, `${String(tick).padStart(6, '0')}.jpg`))
    }
    ffmpeg([
      '-framerate',
      String(FPS),
      '-i',
      path.join(ticks, '%06d.jpg'),
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      ...H264,
      out,
    ])
  }
}

const H264 = [
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '13',
  '-maxrate',
  '80M',
  '-bufsize',
  '160M',
  '-profile:v',
  'high',
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-movflags',
  '+faststart',
]

export const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
