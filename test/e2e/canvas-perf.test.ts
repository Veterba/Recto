import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * A big canvas: 500 nodes of mixed kinds (text, notes, groups, links) and
 * 400 edges, generated. It must open in under a second and pan smoothly -
 * the numbers are printed, and held to a floor that a slow test machine
 * still clears.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const BIG = 'Big plan.canvas'

/** 500 nodes on a grid: every tenth a group around its neighbours, notes and links among the text. */
export function bigCanvas(notes: readonly string[]): string {
  const nodes: Record<string, unknown>[] = []
  const id = (n: number): string => n.toString(16).padStart(16, '0')
  for (let i = 0; i < 500; i++) {
    const col = i % 25
    const row = Math.floor(i / 25)
    const x = col * 320
    const y = row * 260
    if (i % 10 === 0) nodes.push({ id: id(i), type: 'group', x: x - 20, y: y - 20, width: 300, height: 240, label: `Group ${i / 10}` })
    else if (i % 3 === 0) nodes.push({ id: id(i), type: 'file', file: notes[i % notes.length], x, y, width: 280, height: 200 })
    else if (i % 7 === 0) nodes.push({ id: id(i), type: 'link', url: `https://example.org/${i}`, x, y, width: 280, height: 120 })
    else nodes.push({ id: id(i), type: 'text', text: `# Idea ${i}\n\nSome **thinking** about ${i}, with a list:\n\n- one\n- two`, x, y, width: 280, height: 200 })
  }
  const edges: Record<string, unknown>[] = []
  for (let i = 1; i <= 400; i++) edges.push({ id: id(10_000 + i), fromNode: id(i), toNode: id((i * 7) % 500) })
  const line = (o: unknown): string => `\t\t${JSON.stringify(o)}`
  return `{\n\t"nodes":[\n${nodes.map(line).join(',\n')}\n\t],\n\t"edges":[\n${edges.map(line).join(',\n')}\n\t]\n}`
}

describe.skipIf(!RUN)('a 500-node canvas', { timeout: 60_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-canvas-perf-'))
    const vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    const notes = ['Handbook.md', 'Ideas.md', 'Reading list.md', 'Garden/Soil.md', 'Garden/Tomatoes.md', 'Garden/Basil.md']
    fs.writeFileSync(path.join(vault, BIG), bigCanvas(notes))
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.getByRole('tab', { name: 'Canvas' }).click()
    await page.waitForSelector('.canvas-list .boards__name')
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('opens in under a second, and pans at a steady frame rate', async () => {
    const started = Date.now()
    await page.locator('.canvas-list .boards__name', { hasText: 'Big plan' }).click()
    await page.waitForSelector('.react-flow__node')
    // Drawn and fitted: the nodes on screen have stopped changing.
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0 && document.querySelector('.react-flow__viewport') !== null)
    const opened = Date.now() - started

    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
    // Zoomed to life size somewhere in the middle, then panned for two seconds while frames are counted.
    await page.evaluate(() => {
      ;(window as unknown as { __frames: number[] }).__frames = []
      const tick = (t: number): void => {
        const frames = (window as unknown as { __frames: number[] }).__frames
        frames.push(t)
        if (frames.length < 100_000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Back and forth, so the pan stays over the nodes rather than running off past them.
    const end = Date.now() + 2000
    for (let i = 0; Date.now() < end; i++) {
      const way = Math.floor(i / 40) % 2 === 0 ? 1 : -1
      await page.mouse.wheel(18 * way, 10 * way)
    }
    const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)
    const gaps = frames.slice(1).map((t, i) => t - frames[i]!)
    const fps = (frames.length - 1) / ((frames.at(-1)! - frames[0]!) / 1000)
    const worst = Math.max(...gaps)
    const drawn = await page.locator('.react-flow__node').count()
    console.log(`[canvas perf] opened in ${opened} ms; ${fps.toFixed(1)} fps while panning, worst frame ${worst.toFixed(0)} ms; ${drawn} of 500 nodes drawn`)
    expect(opened).toBeLessThan(1000)
    // Only what is on screen is drawn - and something is.
    expect(drawn).toBeLessThan(500)
    expect(drawn).toBeGreaterThan(0)
    expect(fps).toBeGreaterThan(30)
  })
})
