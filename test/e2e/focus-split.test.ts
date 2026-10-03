import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Focus mode entered from a pane of a split looks exactly like focus mode from
 * a single pane - the text in a centred column of the usual width - and
 * leaving it puts the split back as it was: sizes, active pane, scroll.
 *
 * It used to keep the pane's width and offset: a narrow column at the left.
 * Runs with `npm run test:e2e`; the window is never shown
 * (scripts/snapshot-isolate.cjs).
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RUN)('focus mode from a split pane', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''

  /**
   * The writing column of the editor in the focused pane: its gaps to the left
   * and right edges of the scroller's visible area (a classic scrollbar is not
   * part of it), its width, and how much of the window the scroller spans.
   */
  const column = (): Promise<{ left: number; right: number; width: number; span: number; window: number }> =>
    page.evaluate(() => {
      const content = document.querySelector('.tabs.is-focused .cm-content') ?? document.querySelector('.cm-content')!
      const scroller = content.closest('.cm-scroller')!
      const c = content.getBoundingClientRect()
      const s = scroller.getBoundingClientRect()
      return {
        left: c.x - s.x,
        right: s.x + scroller.clientWidth - (c.x + c.width),
        width: c.width,
        span: s.width,
        window: window.innerWidth,
      }
    })
  const centred = (c: { left: number; right: number; span: number; window: number }): void => {
    expect(Math.abs(c.left - c.right)).toBeLessThanOrEqual(2)
    // The pane takes the whole window, as focus mode from a single pane does (inside the shell's inset).
    if (single !== undefined) expect(Math.abs(c.span - single.span)).toBeLessThanOrEqual(2)
  }
  /**
   * Every pane: its box, what is at the top of its view (the first visible
   * line's text, and how far into it the view starts), and whether it is the
   * active one. What is on screen, not the scroll offset in pixels:
   * CodeMirror's estimate of the height above the view can change while the
   * same text stays at the top.
   */
  const layout = (): Promise<{ width: number; height: number; top: string; into: number; active: boolean }[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-tabs-id]')].map((tabs) => {
        const r = tabs.getBoundingClientRect()
        const scroller = tabs.querySelector('.cm-scroller')!
        const edge = scroller.getBoundingClientRect().top
        const line = [...tabs.querySelectorAll('.cm-line')].find((l) => l.getBoundingClientRect().bottom > edge + 1)
        return {
          width: Math.round(r.width),
          height: Math.round(r.height),
          top: (line?.textContent ?? '').slice(0, 30),
          into: Math.round(edge - (line?.getBoundingClientRect().top ?? edge)),
          active: tabs.classList.contains('is-focused'),
        }
      }),
    )
  const toggleFocus = async (): Promise<void> => {
    await page.keyboard.press('Meta+Shift+Enter')
    // Panes fold over 420ms, then scroll positions are put back.
    await sleep(1100)
  }
  const focusPane = async (n: number): Promise<void> => {
    await page
      .locator('.cm-content')
      .nth(n)
      .click({ position: { x: 20, y: 20 } })
    await sleep(200)
  }
  const scrollPane = (n: number, top: number): Promise<void> =>
    page.evaluate(
      ([n, top]) => {
        document.querySelectorAll<HTMLElement>('.cm-scroller')[n!]!.scrollTop = top!
      },
      [n, top],
    )

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-focus-'))
    const vault = path.join(base, 'Focus vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    // Long enough to scroll, with lines long enough to wrap differently at different widths.
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: ${'words that wrap across the column '.repeat(6)}`)
    fs.writeFileSync(path.join(vault, 'Alpha.md'), `# Alpha\n\n${paragraphs.join('\n\n')}\n`)
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.locator('[role=treeitem]', { hasText: 'Alpha' }).click()
    await page.waitForSelector('.cm-content')
    await sleep(500)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    fs.rmSync(base, { recursive: true, force: true })
  })

  let single: Awaited<ReturnType<typeof column>> | undefined

  it('from a single pane: the reference column', async () => {
    await focusPane(0)
    await toggleFocus()
    const reference = await column()
    await toggleFocus()
    centred(reference)
    single = reference
  }, 30_000)

  it('from the right pane of a split: the same column, centred; the split comes back as it was', async () => {
    await page.keyboard.press('Meta+Alt+ArrowRight')
    await sleep(600)
    await scrollPane(0, 900)
    await scrollPane(1, 1800)
    await focusPane(1)
    await sleep(300)
    const before = await layout()
    expect(before).toHaveLength(2)

    await toggleFocus()
    const focused = await column()
    centred(focused)
    expect(Math.abs(focused.width - single!.width)).toBeLessThanOrEqual(2)

    await toggleFocus()
    const after = await layout()
    for (const [i, pane] of after.entries()) {
      expect(Math.abs(pane.width - before[i]!.width)).toBeLessThanOrEqual(1)
      expect(pane.active).toBe(before[i]!.active)
      expect(pane.top).toBe(before[i]!.top)
      expect(Math.abs(pane.into - before[i]!.into)).toBeLessThanOrEqual(4)
    }
  }, 30_000)

  it('from the left pane: the same', async () => {
    await focusPane(0)
    const before = await layout()
    await toggleFocus()
    const focused = await column()
    centred(focused)
    expect(Math.abs(focused.width - single!.width)).toBeLessThanOrEqual(2)
    await toggleFocus()
    const after = await layout()
    for (const [i, pane] of after.entries()) {
      expect(Math.abs(pane.width - before[i]!.width)).toBeLessThanOrEqual(1)
      expect(pane.top).toBe(before[i]!.top)
      expect(Math.abs(pane.into - before[i]!.into)).toBeLessThanOrEqual(4)
    }
  }, 30_000)

  it('from a pane of a split inside a split (three panes): the same', async () => {
    await focusPane(1)
    await page.keyboard.press('Meta+Alt+ArrowDown')
    await sleep(600)
    await focusPane(2)
    const before = await layout()
    expect(before).toHaveLength(3)
    await toggleFocus()
    const focused = await column()
    centred(focused)
    expect(Math.abs(focused.width - single!.width)).toBeLessThanOrEqual(2)
    await toggleFocus()
    const after = await layout()
    for (const [i, pane] of after.entries()) {
      expect(Math.abs(pane.width - before[i]!.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(pane.height - before[i]!.height)).toBeLessThanOrEqual(1)
      expect(pane.active).toBe(before[i]!.active)
    }
  }, 30_000)
})
