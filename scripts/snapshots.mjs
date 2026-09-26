// Screenshots of every main screen, light and dark, on a fixed vault: the
// visual baseline a refactor is checked against.
//
//   npm run snapshots                          build, then shoot into snapshots/current/
//   npm run snapshots -- --out <dir>           shoot into <dir>
//   npm run snapshots -- --compare <dir>       shoot, then compare pixel by pixel with <dir>;
//                                              writes *.diff.png for each difference, exit 1 if any
//
// The vault is test/fixtures/snapshot-vault, copied fresh each run into a
// folder with a fixed name (the name is on screen). Everything that could make
// two runs differ is pinned: file dates, the window size, the renderer's clock
// (Date only - timers still run), and reduced motion, which the home scene and
// the graph honour. Runs the built app (out/), not the dev server.
//
// It also checks, after the screenshots, that the basics still work: a typed
// edit reaches the file on disk, and a search finds notes.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'

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
const SETTINGS_TABS = ['Appearance', 'Editor', 'Writing', 'Templates', 'Topics', 'Obsidian', 'AI', 'Shortcuts', 'Vault']

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = path.resolve(flag('--out') ?? path.join(ROOT, 'snapshots/current'))
const COMPARE = flag('--compare') ? path.resolve(flag('--compare')) : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function prepareVault(theme) {
  // A fixed path, not a random one: Settings -> Vault shows it.
  const base = path.join(os.tmpdir(), 'recto-snapshots', theme)
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const vault = path.join(base, 'Snapshot vault')
  const userData = path.join(base, 'user-data')
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
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
  return { base, vault, userData }
}

async function launch(userData) {
  const app = await _electron.launch({
    args: [ROOT, `--user-data-dir=${userData}`],
    // The vault is a throwaway copy: open it as it is (see dev-guard).
    env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
  })
  // Out of the way: the window never takes the screen from whoever is working.
  await app.evaluate(({ app }) => app.hide())
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h), [WIDTH, HEIGHT])
  const page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(NOW)
  // Randomness made repeatable (the home scene's noise, among others). The
  // graph's layout runs in a worker this does not reach; it settles to within
  // a few pixels.
  await page.addInitScript(() => {
    let seed = 0x2f6b
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // macOS overlay scrollbars fade in and out on their own schedule.
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      // Both: an element with `scrollbar-width` set ignores the pseudo-element.
      style.textContent = '* { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }'
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
  await page.screenshot({ path: path.join(dir, `${name}.png`), caret: 'hide', animations: 'disabled' })
  console.log(`  ${name}`)
}

async function screens(page, dir) {
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
  for (let y = 0; y <= 20_000; y += 500) {
    await page.evaluate((top) => document.querySelector('.cm-scroller')?.scrollTo(0, top), y)
    await sleep(60)
  }
  await page.evaluate(() => document.querySelector('.cm-scroller')?.scrollTo(0, 1600))
  await sleep(300)
  await page.evaluate(() => document.querySelector('.cm-scroller')?.scrollTo(0, 1600))
  await shoot(page, dir, '04-editor-long-note-scrolled')

  await key(page, 'Mod+Shift+F')
  await page.keyboard.type('soil')
  // Results arrive after a debounce and a query; wait for them, then for them to stop changing.
  await page.waitForSelector('.palette--search .result')
  await shoot(page, dir, '05-search-open', 1000)
  await page.keyboard.press('Escape')

  await key(page, 'Mod+G')
  // The layout settles on its own; wait until the graph says so.
  await page.waitForFunction(() => !document.querySelector('.graph__stat')?.textContent?.includes('settling'), null, { timeout: 30_000 }).catch(() => {})
  await shoot(page, dir, '06-graph', 1500)
  await key(page, 'Mod+G')

  await key(page, 'Mod+3')
  await sleep(500)
  await page.getByText('Launch', { exact: true }).first().click()
  await shoot(page, dir, '07-board', 1800)
  await key(page, 'Mod+1')

  await key(page, 'Mod+,')
  for (const [i, tab] of SETTINGS_TABS.entries()) {
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: tab, exact: true }).click()
    // The first tab waits out the dialog's own entrance.
    await shoot(page, dir, `${String(8 + i).padStart(2, '0')}-settings-${tab.toLowerCase()}`, i === 0 ? 3000 : 700)
  }
  await page.keyboard.press('Escape')

  await key(page, 'Mod+Shift+H')
  await shoot(page, dir, '17-home', 2500)
  await page.keyboard.press('ArrowRight')
  await shoot(page, dir, '18-statistics', 3000)
  await page.keyboard.press('Escape')
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
    async ([pa, pb]) => {
      // Not fetch(data:...): the app's content security policy refuses it.
      const load = (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
      const [ia, ib] = await Promise.all([load(pa), load(pb)])
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`, diff: -1 }
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
        const same = da.data[i] === db.data[i] && da.data[i + 1] === db.data[i + 1] && da.data[i + 2] === db.data[i + 2] && da.data[i + 3] === db.data[i + 3]
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
    [pa, pb],
  )
  if (result.png) fs.writeFileSync(diffPath, Buffer.from(result.png, 'base64'))
  return result
}

fs.rmSync(OUT, { recursive: true, force: true })
let failures = 0
for (const theme of ['light', 'dark']) {
  console.log(`${theme}:`)
  const dir = path.join(OUT, theme)
  fs.mkdirSync(dir, { recursive: true })
  const { base, vault, userData } = prepareVault(theme)
  const { app, page } = await launch(userData)
  try {
    await screens(page, dir)
    await smoke(page, vault)
    if (COMPARE !== null) {
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
        const old = path.join(COMPARE, theme, name)
        if (!fs.existsSync(old)) {
          console.log(`  ${name}: not in the baseline`)
          failures++
          continue
        }
        const r = await compare(page, old, path.join(dir, name), path.join(dir, name.replace('.png', '.diff.png')))
        if (r.diff === -1 || r.diff >= NOISE_PIXELS) {
          failures++
          console.log(`  ${name}: ${r.diff === -1 ? `size ${r.size}` : `${r.diff} of ${r.total} pixels differ`} - see ${name.replace('.png', '.diff.png')}`)
        } else if (r.diff > 0) {
          console.log(`  ${name}: ${r.diff} pixels differ (rasteriser noise, under ${NOISE_PIXELS})`)
        }
      }
    }
  } finally {
    await app.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
}
if (COMPARE !== null) console.log(failures === 0 ? 'same as the baseline' : `${failures} screenshot(s) differ from the baseline`)
process.exit(failures === 0 ? 0 : 1)
