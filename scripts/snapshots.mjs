// Screenshots of every main screen, light and dark, on a fixed vault: the
// visual baseline a refactor is checked against.
//
//   npm run snapshots                          build, then shoot into snapshots/current/
//   npm run snapshots -- --out <dir>           shoot into <dir>
//   npm run snapshots -- --compare <dir>       shoot, then compare pixel by pixel with <dir>;
//                                              exit 1 if any differ. Each difference is kept, with
//                                              the shot, as snapshots/diffs/<theme>/<shot>.run-<n>.diff.png
//                                              (n counts compare runs; earlier runs' files stay)
//   npm run snapshots -- --styles              also record every element's computed style (and its
//                                              ::before/::after) per screen; --compare then compares
//                                              those too - catching what pixels cannot, like transitions
//
// The vault is test/fixtures/snapshot-vault, copied fresh each run into a
// folder with a fixed name (the name is on screen). Everything that could make
// two runs differ is pinned: file dates, the window size, the renderer's clock
// (Date only - timers still run), and reduced motion, which the home scene and
// the graph honour. Runs the built app (out/), not the dev server.
//
// It also checks, after the screenshots, that the basics still work: a typed
// edit reaches the file on disk, and a search finds notes.
//
// The bot (features/recto-bot) is shot apart from the app: its still poses -
// a fixed seed and a fixed moment each - from the dev-only design page
// (/dev/recto-bot?still), served by Vite and opened in a bare Electron window.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = path.resolve(import.meta.dirname, '..')
const FIXTURE = path.join(ROOT, 'test/fixtures/snapshot-vault')
const WIDTH = 1440
const HEIGHT = 900
/** The date every file carries and the renderer's clock reads. */
const NOW = new Date('2026-09-20T10:00:00')
/**
 * Pixels two identical runs may still differ by: Chromium's GPU rasteriser
 * anti-aliases a rounded corner or an icon edge a shade differently from one
 * launch to the next (measured: up to 55 per shot, all on edges). Software
 * rendering would be exact, but cannot capture a hidden window. Every
 * difference is still printed; only this many or more fails the run.
 */
const NOISE_PIXELS = 100
/**
 * How far one colour channel may differ and still count as the same pixel.
 * A translucent surface over a blurred one (the find card's input over the
 * glass) is blended by the GPU compositor, which rounds it a level either way
 * from run to run: measured, 9,771 pixels of the input off by exactly 1.
 * A real change moves a colour by far more than one level in 255.
 */
const LEVELS = 1
const SETTINGS_TABS = ['Appearance', 'Editor', 'Writing', 'Templates', 'Topics', 'Obsidian', 'AI', 'Shortcuts', 'Vault']

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = path.resolve(flag('--out') ?? path.join(ROOT, 'snapshots/current'))
const COMPARE = flag('--compare') ? path.resolve(flag('--compare')) : null
const STYLES = args.includes('--styles')
/** Record which CSS rules any screen used (Chrome's CSS coverage), into <out>/<theme>/css-coverage.json. */
const COVERAGE = args.includes('--coverage')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Isolation. Every run works on a fresh copy of the fixture vault and gives
 * every Electron it starts a new, empty profile (userData); both are deleted
 * when the run ends. The vault's folder has a fixed path, because Settings ->
 * Vault shows it - so only one run may hold it at a time (SNAPSHOT_LOCK).
 */
const SNAPSHOT_ROOT = path.join(os.tmpdir(), 'recto-snapshots')
const SNAPSHOT_LOCK = path.join(SNAPSHOT_ROOT, 'run.lock')
const profiles = []
/**
 * Keeps the user's typing and clicks out of every Electron the run starts (see
 * snapshot-isolate.cjs). As an argument: Playwright drops NODE_OPTIONS.
 */
const ISOLATE = ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs')]

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Takes the run lock, or exits saying who holds it. A lock left by a dead run is taken over. */
function lockRun() {
  fs.mkdirSync(SNAPSHOT_ROOT, { recursive: true })
  for (;;) {
    try {
      fs.writeFileSync(SNAPSHOT_LOCK, String(process.pid), { flag: 'wx' })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const holder = Number(fs.readFileSync(SNAPSHOT_LOCK, 'utf8'))
      if (alive(holder)) {
        console.error(`Another snapshot run (pid ${holder}) is using ${SNAPSHOT_ROOT}. Wait for it to finish, or stop it, then run again.`)
        process.exit(2)
      }
      fs.rmSync(SNAPSHOT_LOCK, { force: true })
    }
  }
}

/** Deletes every profile and vault copy this run made, and gives the lock back. */
function cleanUp() {
  for (const dir of profiles) fs.rmSync(dir, { recursive: true, force: true })
  for (const theme of ['light', 'dark']) fs.rmSync(path.join(SNAPSHOT_ROOT, theme), { recursive: true, force: true })
  if (fs.existsSync(SNAPSHOT_LOCK) && fs.readFileSync(SNAPSHOT_LOCK, 'utf8') === String(process.pid)) fs.rmSync(SNAPSHOT_LOCK)
  // The folder itself, once empty - another run's lock keeps it.
  if (fs.existsSync(SNAPSHOT_ROOT) && fs.readdirSync(SNAPSHOT_ROOT).length === 0) fs.rmdirSync(SNAPSHOT_ROOT)
}

/**
 * A new, empty profile for one Electron. Refuses to go on if Recto (or any
 * Chromium) is already running on it: its SingletonLock names a live process.
 */
function newProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-snapshot-profile-'))
  profiles.push(dir)
  return dir
}

function assertProfileFree(dir) {
  let target
  try {
    target = fs.readlinkSync(path.join(dir, 'SingletonLock'))
  } catch {
    return
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  if (alive(pid)) {
    console.error(`A Recto instance (pid ${pid}) is already running with the profile ${dir}. Quit it, then run again.`)
    cleanUp()
    process.exit(2)
  }
}

function prepareVault(theme, folder = theme) {
  // A fixed path, not a random one: Settings -> Vault shows it.
  const base = path.join(SNAPSHOT_ROOT, folder)
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const vault = path.join(base, 'Snapshot vault')
  const userData = newProfile()
  fs.cpSync(FIXTURE, vault, { recursive: true })
  fs.writeFileSync(path.join(vault, '.recto', 'appearance.json'), JSON.stringify({ theme }))
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      fs.utimesSync(p, NOW, NOW)
    }
  }
  walk(vault)
  fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
  return { base, vault, userData }
}

async function launch(userData) {
  assertProfileFree(userData)
  const app = await _electron.launch({
    args: [...ISOLATE, ROOT, `--user-data-dir=${userData}`],
    // The vault is a throwaway copy: open it as it is (see dev-guard).
    // Bots answer from a fixed stand-in, so a bot chat needs no Ollama and reads the same every run.
    env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1' },
  })
  // Out of the way: the window never takes the screen from whoever is working.
  await app.evaluate(({ app }) => app.hide())
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h), [WIDTH, HEIGHT])
  // A hidden window stops drawing once nothing moves - and nothing does, with
  // animations off below - so a screenshot could wait forever for a frame.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setBackgroundThrottling(false))
  const page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(NOW)
  // Randomness made repeatable (the home scene's noise, among others). The
  // graph's layout runs in a worker this does not reach; it settles to within
  // a few pixels.
  await page.addInitScript(() => {
    // The home scene's own debug switches (features/home/scene-flags.ts): one
    // still frame, deaf to the pointer.
    localStorage.setItem('homeFlags', JSON.stringify({ freeze: true, noInput: true }))
    // The bots' own switch (features/recto-bot/loop.ts): their resting face, no blinks.
    localStorage.setItem('rectoBotStill', '1')
    let seed = 0x2f6b
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // macOS overlay scrollbars fade in and out on their own schedule, and
    // anything still in motion is a different picture each run.
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      // Both: an element with `scrollbar-width` set ignores the pseudo-element.
      style.textContent = '* { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }'
      // No motion at all: every transition and animation lands on its end state
      // at once. Reduced motion already shortens most to 1ms, but lets a few
      // back (the find card's fade). The :not(#…) lifts this rule to id
      // specificity, so it wins over those `!important` rules too. Zero rather
      // than `none`: an animation that fills forwards still ends where it
      // should.
      style.textContent += `
        *:not(#snapshot), *:not(#snapshot)::before, *:not(#snapshot)::after {
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
        }`
      // No grain on the frosted chrome: the same noise is rasterised a little
      // differently from time to time (measured: the same mean colour, single
      // pixels up to 6 levels apart), and it is texture, not what is checked.
      style.textContent += ':root { --grain-amount: 0 !important; --grain-boost: 0 !important; }'
      document.head.append(style)
    })
  })
  await page.reload()
  await page.waitForSelector('[role=treeitem]')
  await sleep(1500)
  return { app, page }
}

const key = (page, combo) => page.keyboard.press(combo.replace('Mod', 'Meta'))

async function shoot(page, dir, name, settle = 700) {
  await sleep(settle)
  // Caret blink and hover are the only moving parts left; park the mouse.
  await page.mouse.move(WIDTH - 2, HEIGHT - 2)
  // A frame for :hover to leave whatever the mouse was over.
  await sleep(150)
  // Styles before the screenshot: taking it hides the caret, which is a style.
  if (STYLES) fs.writeFileSync(path.join(dir, `${name}.styles.json`), JSON.stringify(await computedStyles(page)))
  await page.screenshot({ path: path.join(dir, `${name}.png`), caret: 'hide', animations: 'disabled' })
  console.log(`  ${name}`)
}

/** Scroll the open note end to end, so CodeMirror has measured every line instead of estimating it. */
async function measureNote(page) {
  for (let y = 0; y <= 20_000; y += 500) {
    await page.evaluate((top) => document.querySelector('.cm-scroller')?.scrollTo(0, top), y)
    await sleep(60)
  }
}

/**
 * Until the find card is at rest: no animation running on the page, one
 * scrollbar tick per counted match, and the note's scroll and the ticks the
 * same over ten frames in a row.
 */
async function settleFind(page) {
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const state = () => {
          const ticks = [...document.querySelectorAll('.find-marks__tick')].map((t) => t.style.top).join()
          return `${document.querySelector('.cm-scroller')?.scrollTop}|${ticks}`
        }
        const count = Number(/\/\s*(\d+)/.exec(document.querySelector('.find__count')?.textContent ?? '')?.[1] ?? -1)
        const first = state()
        let frames = 0
        const check = () => {
          const busy = document.getAnimations().some((a) => a.playState === 'running')
          const ticks = document.querySelectorAll('.find-marks__tick').length
          if (busy || ticks !== count || state() !== first) return resolve(false)
          if (++frames === 10) return resolve(true)
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
    null,
    { polling: 100, timeout: 15_000 },
  )
}

async function screens(page, dir, vault) {
  await shoot(page, dir, '01-start')

  await page.getByRole('button', { name: 'Expand all folders' }).click()
  await shoot(page, dir, '02-tree-expanded')

  await key(page, 'Mod+O')
  await page.keyboard.type('Handbook')
  await sleep(300)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.cm-content')
  await shoot(page, dir, '03-editor-long-note', 1200)
  // CodeMirror guesses the height of lines it has not drawn, so a pixel offset
  // lands on different lines from run to run. Pass over the whole note first,
  // so every line is measured, then go to the offset.
  await measureNote(page)
  await page.evaluate(() => document.querySelector('.cm-scroller')?.scrollTo(0, 1600))
  await sleep(300)
  await page.evaluate(() => document.querySelector('.cm-scroller')?.scrollTo(0, 1600))
  await shoot(page, dir, '04-editor-long-note-scrolled')

  await key(page, 'Mod+Shift+F')
  await page.keyboard.type('soil')
  // Results arrive after a debounce and a query; wait for them, then for them to stop changing.
  await page.waitForSelector('.palette--search .search-result')
  await shoot(page, dir, '05-search-open', 1000)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.palette--search', { state: 'detached' })

  await key(page, 'Mod+G')
  await page.waitForSelector('.graph__canvas')
  // The layout settles on its own; wait until the graph says so.
  await page
    .waitForFunction(() => !document.querySelector('.graph__stat')?.textContent?.includes('settling'), null, { timeout: 30_000 })
    .catch(() => {})
  await shoot(page, dir, '06-graph', 1500)
  await key(page, 'Mod+G')
  await page.waitForSelector('.graph__canvas', { state: 'detached' })

  await key(page, 'Mod+3')
  await page.waitForSelector('.boards__row')
  await page.locator('.boards__row', { hasText: 'Launch' }).first().click()
  await page.waitForSelector('.board__card')
  await shoot(page, dir, '07-board', 1800)
  await key(page, 'Mod+1')
  await page.waitForSelector('[role=treeitem]')

  await key(page, 'Mod+,')
  await page.waitForSelector('[role=dialog][aria-label=Settings]')
  for (const [i, tab] of SETTINGS_TABS.entries()) {
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: tab, exact: true }).click()
    // The first tab waits out the dialog's own entrance.
    await shoot(page, dir, `${String(8 + i).padStart(2, '0')}-settings-${tab.toLowerCase()}`, i === 0 ? 3000 : 700)
  }
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role=dialog][aria-label=Settings]', { state: 'detached' })

  // Each step waits for what it should have done, so a key press that did not
  // land fails the run instead of photographing the wrong screen.
  const pane = (name) => page.waitForFunction((n) => document.querySelector('.home__live')?.textContent === n, name)
  // The overlay measures its type once, as it opens, to hold the glass dark
  // behind it. Its fonts load lazily; one that lands after that measurement
  // leaves the glass shaped around the fallback font. Load them first.
  await page.evaluate(() =>
    Promise.all(['italic 400 16px "Bodoni Moda"', '500 16px "Geist Sans"', '500 16px "Geist Mono"'].map((f) => document.fonts.load(f))),
  )
  await key(page, 'Mod+Shift+H')
  await pane('Recto')
  await shoot(page, dir, '17-home', 2500)
  await page.keyboard.press('ArrowRight')
  await pane('Statistics')
  await shoot(page, dir, '18-statistics', 3000)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.home__live', { state: 'detached' })

  // Find in the note: the card, then the card with replace. What is behind
  // the glass card, and where the match ticks sit, both depend on line heights
  // CodeMirror has measured rather than guessed - so the whole note is
  // measured first and the search starts from the top, every run alike.
  await measureNote(page)
  await page.evaluate(() => {
    document.querySelector('.cm-scroller')?.scrollTo(0, 0)
    document.querySelector('.cm-content')?.focus()
  })
  await key(page, 'Mod+F')
  await page.waitForSelector('.find')
  await page.keyboard.type('soil')
  await page.waitForFunction(() => document.querySelector('.find__count')?.textContent?.includes('/'))
  await settleFind(page)
  await shoot(page, dir, '19-find-bar')
  await key(page, 'Mod+Alt+F')
  await page.waitForSelector('.find__row--replace:not([hidden])')
  await page.keyboard.type('earth')
  await settleFind(page)
  await shoot(page, dir, '20-find-replace')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.find', { state: 'detached' })

  // Focus mode from the right pane of a split: the same centred column as from
  // a single pane, not the pane's half of the window. Then the split goes again.
  await page.evaluate(() => {
    document.querySelector('.cm-scroller')?.scrollTo(0, 0)
    document.querySelector('.cm-content')?.focus()
  })
  await key(page, 'Mod+Alt+ArrowRight')
  await page.waitForFunction(() => document.querySelectorAll('[data-tabs-id]').length === 2)
  await page.evaluate(() => {
    const right = document.querySelectorAll('.cm-content')[1]
    right?.closest('.cm-editor')?.querySelector('.cm-scroller')?.scrollTo(0, 0)
    right?.focus()
  })
  await key(page, 'Mod+Shift+Enter')
  await page.waitForSelector(':root[data-focus="on"]')
  // The caret blinks; focus mode and the active pane stay without it.
  await sleep(600)
  await page.evaluate(() => document.activeElement?.blur())
  await shoot(page, dir, '20b-focus-from-split', 800)
  await key(page, 'Mod+Shift+Enter')
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-focus'))
  await sleep(700)
  await key(page, 'Mod+W')
  await page.waitForFunction(() => document.querySelectorAll('[data-tabs-id]').length === 1)

  // The AI section: Recto, the main chat - first with nothing said yet.
  await key(page, 'Mod+2')
  await page.waitForSelector('.bot-chat .chat__welcome')
  await page.waitForSelector('.bot-chat .composer__capsule')
  await shoot(page, dir, '21b-chat-empty')
  await key(page, 'Mod+1')
  await page.waitForSelector('[role=treeitem]')

  // Then with one earlier topic, written the way the chat writes them: grouped
  // messages, and an answer with its steps and sources. It arrives only now -
  // as a note it would change every screen above - begun at 09:30 by the run's
  // clock: written aside, dated, then moved in, so the watcher sees it whole.
  const folder = path.join(vault, 'chats', 'recto')
  fs.mkdirSync(folder, { recursive: true })
  const aside = path.join(vault, 'chats', '.topic.tmp')
  const meta = (fields) => `<!-- recto:meta ${JSON.stringify(fields)} -->`
  const sources = ['Garden/Soil.md', 'Garden/Beds/Raised beds.md', 'Garden/Tomatoes.md', 'Garden/Basil.md', 'Handbook.md', 'Ideas.md'].map(
    (p) => ({ path: p, heading: null }),
  )
  fs.writeFileSync(
    aside,
    [
      '---\nbot: recto\ncreated: 2026-09-20T09:30:02\ntitle: Soil mix\n---\n',
      '## You\n\nWhat goes in the soil mix?\n',
      meta({ at: '2026-09-20T09:30:02' }) + '\n',
      '## You\n\nFor the [[Raised beds]] by the fence\n',
      meta({ at: '2026-09-20T09:30:20' }) + '\n',
      '## Recto\n\nYour notes in Soil say **compost, loam and grit** in equal parts:\n\n- compost for food\n- loam to hold water\n- grit so the roots can breathe\n',
      meta({
        at: '2026-09-20T09:30:41',
        model: 'qwen3.5:9b',
        sources,
        steps: [
          { action: 'Opened', result: 'Raised beds', state: 'done' },
          { action: 'Searching notes', result: '“soil mix” · 3 notes', state: 'done' },
        ],
      }) + '\n',
      '## Recto\n\nWant the ratios for pots too?\n',
      meta({ at: '2026-09-20T09:30:44', model: 'qwen3.5:9b' }) + '\n',
    ].join('\n'),
  )
  const earlier = new Date(NOW.getTime() - 30 * 60_000)
  fs.utimesSync(aside, earlier, earlier)
  fs.renameSync(aside, path.join(folder, '2026-09-20 09-30 — Soil mix.md'))
  await key(page, 'Mod+2')
  await page.waitForFunction(() => document.querySelector('.bot-row__time')?.textContent === '09:30')
  await page.waitForSelector('.bot-chat .msg--bot')
  await shoot(page, dir, '22-ai-sidebar')

  // A question in the current topic, answered with its sources.
  await page.locator('.bot-chat .composer__input').click()
  await page.keyboard.type('How do I mix soil for raised beds?')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.bot-chat .msg--bot').length === 3)
  await page.waitForSelector('.bot-chat .msg-group--bot:last-of-type .msg-sources')
  await page.waitForFunction(() => document.querySelector('.bot-row__time')?.textContent === '10:00')
  await page.mouse.move(0, 0)
  await shoot(page, dir, '23-bot-chat')

  // The steps behind the first answer, unfolded.
  await page.locator('.bot-chat .bot-steps--folded').first().click()
  await page.waitForSelector('.bot-chat .bot-steps__row')
  await page.locator('.bot-chat .bot-steps').first().scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await shoot(page, dir, '23b-steps-open')
  await page.locator('.bot-chat .bot-steps').first().click()
  await page.waitForSelector('.bot-chat .bot-steps__row', { state: 'detached' })

  // The model menu, and the + menu.
  await page.locator('.bot-chat .composer__chip').click()
  await page.waitForFunction(() => document.querySelectorAll('.model-menu .glass-menu__item').length >= 4)
  await page.mouse.move(0, 0)
  await shoot(page, dir, '23c-model-menu')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.model-menu', { state: 'detached' })
  await page.locator('.bot-chat .composer__plus').click()
  await page.waitForSelector('.plus-menu')
  await page.mouse.move(0, 0)
  await shoot(page, dir, '23d-plus-menu')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.plus-menu', { state: 'detached' })

  // ⌘N: a new topic is a clean page, like a new chat; the one before is in History.
  await page.locator('.bot-chat .composer__input').click()
  await key(page, 'Mod+N')
  await page.waitForSelector('.bot-chat .chat__welcome')
  await page.keyboard.type('Which beds need the most sun?')
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.bot-chat .chat-topic').length === 1 &&
      [...document.querySelectorAll('.chat-topic__divider')].map((d) => d.textContent).join() === 'New topic · Soil mix · 10:00' &&
      document.querySelectorAll('.bot-chat .msg--bot').length === 1,
  )
  await page.mouse.move(0, 0)
  await shoot(page, dir, '24-topic-divider')

  // History: the topics, newest first. A click elsewhere puts it away.
  await page.getByRole('button', { name: 'History' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bot-history__row').length === 2)
  await shoot(page, dir, '25-history')
  await page.locator('.bot-chat .chat__thread').click({ position: { x: 5, y: 5 } })
  await page.waitForSelector('.bot-history', { state: 'detached' })

  // Back to Data: the smoke test after the screens edits a note from the tree.
  // The composer keeps its keys to itself, so it lets go of the focus first.
  await page.evaluate(() => document.activeElement?.blur())
  await key(page, 'Mod+1')
  await page.waitForSelector('[role=treeitem]')
}

/**
 * Every element's computed style, keyed by its path in the document. Styles
 * are stored once in a table and referenced by index: most elements share one.
 */
function computedStyles(page) {
  return page.evaluate(() => {
    const table = []
    const index = new Map()
    const id = (text) => {
      if (!index.has(text)) {
        index.set(text, table.length)
        table.push(text)
      }
      return index.get(text)
    }
    const read = (el, pseudo) => {
      const cs = getComputedStyle(el, pseudo)
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) return -1
      let text = ''
      for (let i = 0; i < cs.length; i++) text += `${cs[i]}:${cs.getPropertyValue(cs[i])};`
      return id(text)
    }
    const pathOf = (el) => {
      const parts = []
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0
        parts.unshift(`${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].join('.') : ''}[${i}]`)
      }
      return parts.join('>')
    }
    const elements = {}
    for (const el of document.querySelectorAll('*')) elements[pathOf(el)] = [read(el, null), read(el, '::before'), read(el, '::after')]
    return { table, elements }
  })
}

/**
 * CodeMirror draws only the lines near the viewport, and places its layers
 * (cursor, selection, indent guides) from its own measurements - so inside the
 * editor, which lines exist and where its layers sit vary from run to run.
 * Only that measured geometry is ignored; any other property still counts.
 */
const GEOMETRY = /^(top|bottom|left|right|inset-.*|height|width|block-size|inline-size|transform|transform-origin|perspective-origin)$/
const inEditor = (p) => p.includes('.cm-scroller')

/** Elements whose computed style differs, with the properties that differ. */
function compareStyles(a, b) {
  const props = (text) =>
    new Map(
      text
        .split(';')
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]),
    )
  const out = []
  for (const [p, ids] of Object.entries(a.elements)) {
    const other = b.elements[p]
    if (!other) {
      if (!inEditor(p)) out.push({ path: p, missing: true })
      continue
    }
    ids.forEach((x, k) => {
      const y = other[k]
      if ((x === -1) !== (y === -1)) return out.push({ path: p, part: k, changed: ['(pseudo-element present in one only)'] })
      if (x === -1 || a.table[x] === b.table[y]) return
      const pa = props(a.table[x])
      const pb = props(b.table[y])
      const changed = [...new Set([...pa.keys(), ...pb.keys()])]
        .filter((key) => pa.get(key) !== pb.get(key))
        .filter((key) => !(inEditor(p) && GEOMETRY.test(key)))
        // A token added or removed is not a style change; what it does shows in real properties.
        .filter((key) => !(key.startsWith('--') && (pa.get(key) === undefined || pb.get(key) === undefined)))
        .map((key) => `${key}: ${pa.get(key)} -> ${pb.get(key)}`)
      if (changed.length) out.push({ path: p, part: k, changed })
    })
  }
  for (const p of Object.keys(b.elements)) if (!a.elements[p] && !inEditor(p)) out.push({ path: p, extra: true })
  return out
}

/** The basics, still working: an edit is saved to disk, and search finds notes. */
async function smoke(page, vault) {
  const file = path.join(vault, 'Ideas.md')
  const before = fs.readFileSync(file, 'utf8')
  await page.locator('[role=treeitem]', { has: page.locator('.tree__name', { hasText: /^Ideas$/ }) }).click()
  await page.waitForFunction(() => document.querySelector('.md__path')?.textContent === 'Ideas.md')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('\nEdited by the snapshot run.')
  let after = before
  for (let i = 0; i < 40 && after === before; i++) {
    await sleep(250)
    after = fs.readFileSync(file, 'utf8')
  }
  if (!after.includes('Edited by the snapshot run.')) throw new Error('smoke: the edit never reached the file')
  const found = await page.evaluate(async () => (await window.api.invoke('index:search', 'tomatoes', 20)).length)
  if (!(found > 0)) throw new Error('smoke: search found nothing for "tomatoes"')
  console.log(`  smoke: edit saved, search found ${found}`)
}

/** Pixel-by-pixel, in the app's own renderer: counts differing pixels and writes a red diff image. */
async function compare(page, a, b, diffPath) {
  const [pa, pb] = [a, b].map((p) => fs.readFileSync(p).toString('base64'))
  const result = await page.evaluate(
    async ([pa, pb, levels]) => {
      // Not fetch(data:...): the app's content security policy refuses it.
      const load = (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
      const [ia, ib] = await Promise.all([load(pa), load(pb)])
      if (ia.width !== ib.width || ia.height !== ib.height)
        return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`, diff: -1 }
      const read = (img) => {
        const c = new OffscreenCanvas(img.width, img.height)
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, img.width, img.height)
      }
      const [da, db] = [read(ia), read(ib)]
      const out = new ImageData(ia.width, ia.height)
      let diff = 0
      for (let i = 0; i < da.data.length; i += 4) {
        const same =
          Math.abs(da.data[i] - db.data[i]) <= levels &&
          Math.abs(da.data[i + 1] - db.data[i + 1]) <= levels &&
          Math.abs(da.data[i + 2] - db.data[i + 2]) <= levels &&
          Math.abs(da.data[i + 3] - db.data[i + 3]) <= levels
        if (!same) diff++
        out.data[i] = same ? da.data[i] * 0.3 + 178 : 255
        out.data[i + 1] = same ? da.data[i + 1] * 0.3 + 178 : 0
        out.data[i + 2] = same ? da.data[i + 2] * 0.3 + 178 : 0
        out.data[i + 3] = 255
      }
      if (diff === 0) return { diff }
      const c = new OffscreenCanvas(ia.width, ia.height)
      c.getContext('2d').putImageData(out, 0, 0)
      const blob = await c.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const x of bytes) s += String.fromCharCode(x)
      return { diff, png: btoa(s), total: ia.width * ia.height }
    },
    [pa, pb, LEVELS],
  )
  if (result.png) fs.writeFileSync(diffPath, Buffer.from(result.png, 'base64'))
  return result
}

/** The renderer, served as in development: the bot's design page exists only there. */
async function serveRenderer() {
  const server = await createServer({
    configFile: false,
    root: path.join(ROOT, 'src/renderer'),
    logLevel: 'error',
    resolve: { alias: { '@renderer': path.join(ROOT, 'src/renderer'), '@shared': path.join(ROOT, 'src/shared') } },
    plugins: [react()],
    server: { port: 0 },
  })
  await server.listen()
  return { server, origin: `http://localhost:${server.httpServer.address().port}` }
}

/** The bot's still poses, sizes 40 and 120, in one shot. */
async function botStills(origin, dir, theme) {
  const userData = newProfile()
  assertProfileFree(userData)
  const app = await _electron.launch({
    args: [...ISOLATE, path.join(ROOT, 'scripts/snapshot-window.cjs'), `--user-data-dir=${userData}`],
    env: { ...process.env, RECTO_URL: `${origin}/dev/recto-bot?still&theme=${theme}` },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.bot-design__stills[data-ready]')
    // Fonts for the labels, then a frame to paint.
    await page.evaluate(() => document.fonts.ready)
    await sleep(300)
    await page.locator('.bot-design__stills').screenshot({ path: path.join(dir, '21-recto-bot.png'), animations: 'disabled' })
    console.log('  21-recto-bot')
  } finally {
    await app.close()
  }
}

/**
 * Diffs outlive the run that made them, so a flake seen once can still be
 * looked at: each compare run takes the next number, and its files carry it.
 */
const DIFFS = path.join(ROOT, 'snapshots/diffs')
/**
 * Tables, in their own run so no other screen changes: the snapshot vault
 * plus an eval-runs table wider than the text column (test/fixtures/tables).
 * Single pane, a split with the table scrolled sideways, and focus mode.
 */
async function tableShots(dir, theme) {
  const { base, vault, userData } = prepareVault(theme, `${theme}-tables`)
  fs.cpSync(path.join(ROOT, 'test/fixtures/tables'), vault, { recursive: true })
  const { app, page } = await launch(userData)
  try {
    await key(page, 'Mod+O')
    await page.keyboard.type('Eval runs')
    await sleep(300)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.cm-table')
    await page.evaluate(() => document.activeElement?.blur())
    await shoot(page, dir, '26-table', 1200)

    await page.evaluate(() => document.querySelector('.cm-content')?.focus())
    await key(page, 'Mod+Alt+ArrowRight')
    await page.waitForFunction(() => document.querySelectorAll('[data-tabs-id]').length === 2)
    await page.waitForFunction(() => document.querySelectorAll('.cm-table').length >= 2)
    await page.evaluate(() => {
      const scroll = document.querySelectorAll('.cm-table-scroll')[0]
      scroll?.scrollTo(160, 0)
      document.activeElement?.blur()
    })
    await shoot(page, dir, '26b-table-split-scrolled', 900)

    await page.evaluate(() => document.querySelectorAll('.cm-content')[1]?.focus())
    await key(page, 'Mod+Shift+Enter')
    await page.waitForSelector(':root[data-focus="on"]')
    await sleep(600)
    await page.evaluate(() => document.activeElement?.blur())
    await shoot(page, dir, '26c-table-focus', 900)
    console.log('  26-table')
  } finally {
    await app.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
}

function nextRun() {
  const counter = path.join(DIFFS, 'last-run')
  const run = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) || 0 : 0) + 1
  fs.mkdirSync(DIFFS, { recursive: true })
  fs.writeFileSync(counter, String(run))
  return run
}
lockRun()
// Whatever ends the run - done, a failed step, Ctrl-C - nothing is left behind.
process.on('exit', cleanUp)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))
const RUN = COMPARE !== null ? nextRun() : 0

fs.rmSync(OUT, { recursive: true, force: true })
const renderer = await serveRenderer()
let failures = 0
for (const theme of ['light', 'dark']) {
  console.log(`${theme}:`)
  const dir = path.join(OUT, theme)
  fs.mkdirSync(dir, { recursive: true })
  const { base, vault, userData } = prepareVault(theme)
  const { app, page } = await launch(userData)
  try {
    if (COVERAGE) await page.coverage.startCSSCoverage({ resetOnNavigation: false })
    await screens(page, dir, vault)
    if (COVERAGE) {
      const used = (await page.coverage.stopCSSCoverage()).map((e) => ({ url: e.url, text: e.text, ranges: e.ranges }))
      fs.writeFileSync(path.join(dir, 'css-coverage.json'), JSON.stringify(used))
    }
    await smoke(page, vault)
    await botStills(renderer.origin, dir, theme)
    await tableShots(dir, theme)
    if (COMPARE !== null) {
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
        const old = path.join(COMPARE, theme, name)
        if (!fs.existsSync(old)) {
          console.log(`  ${name}: not in the baseline`)
          failures++
          continue
        }
        const kept = path.join(DIFFS, theme, name.replace('.png', `.run-${RUN}`))
        fs.mkdirSync(path.dirname(kept), { recursive: true })
        const r = await compare(page, old, path.join(dir, name), `${kept}.diff.png`)
        const oldStyles = path.join(COMPARE, theme, name.replace('.png', '.styles.json'))
        const newStyles = path.join(dir, name.replace('.png', '.styles.json'))
        if (STYLES && fs.existsSync(oldStyles) && fs.existsSync(newStyles)) {
          const d = compareStyles(JSON.parse(fs.readFileSync(oldStyles, 'utf8')), JSON.parse(fs.readFileSync(newStyles, 'utf8')))
          if (d.length > 0) {
            failures++
            fs.writeFileSync(path.join(dir, name.replace('.png', '.styles-diff.json')), JSON.stringify(d, null, 1))
            console.log(`  ${name}: computed style differs on ${d.length} element(s) - see ${name.replace('.png', '.styles-diff.json')}`)
          }
        }
        if (r.diff === -1 || r.diff >= NOISE_PIXELS) {
          failures++
          fs.copyFileSync(path.join(dir, name), `${kept}.png`)
          console.log(
            `  ${name}: ${r.diff === -1 ? `size ${r.size}` : `${r.diff} of ${r.total} pixels differ`} - see ${path.relative(ROOT, kept)}.diff.png`,
          )
        } else if (r.diff > 0) {
          // Noise is not kept: a diff image only for what failed.
          fs.rmSync(`${kept}.diff.png`, { force: true })
          console.log(`  ${name}: ${r.diff} pixels differ (rasteriser noise, under ${NOISE_PIXELS})`)
        }
      }
    }
  } finally {
    await app.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
}
await renderer.server.close()
if (COMPARE !== null)
  console.log(`run ${RUN}: ${failures === 0 ? 'same as the baseline' : `${failures} screenshot(s) differ from the baseline`}`)
process.exit(failures === 0 ? 0 : 1)
