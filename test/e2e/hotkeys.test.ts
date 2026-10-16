import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * Hotkeys, end to end: a new binding works and survives a reload, a taken
 * chord is asked about before anything changes, a chord macOS keeps is
 * refused, and every command with a binding runs from the keyboard - each
 * pressed where it applies (a note, a table cell, or anywhere). Runs with
 * `npm run test:e2e`; the window is never shown.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

type Row = { id: string; binding: string; scope: 'app' | 'editor' | 'table' }

/** 'Mod+Shift+D' as Playwright presses it. */
const toKeys = (binding: string): string =>
  binding
    .split('+')
    .map((part) => ({ Mod: 'Meta', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift' })[part] ?? (part.length === 1 ? part.toLowerCase() : part))
    .join('+')

describe.skipIf(!RUN)('hotkeys', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-hotkeys-'))
    vault = path.join(base, 'vault')
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'topics-settings.json'), JSON.stringify({ enabled: false }))
    fs.writeFileSync(
      path.join(vault, 'Keys.md'),
      '# Keys\n\nA plain paragraph to type in.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nThe end.\n',
    )
    fs.mkdirSync(path.join(base, 'profile'))
    fs.writeFileSync(path.join(base, 'profile', 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(base, 'profile')}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await openNote()
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  async function openNote(): Promise<void> {
    await page.locator('[role=treeitem]', { hasText: 'Keys' }).first().click()
    await page.waitForSelector('.md .cm-content')
    await page.waitForSelector('.cm-tbl td')
  }
  const inNote = async (): Promise<void> => {
    await page.locator('.cm-line', { hasText: 'paragraph to type' }).click()
  }
  const inCell = async (): Promise<void> => {
    await page.locator('.cm-tbl td[data-row="1"][data-col="0"]').click()
  }
  const nowhere = async (): Promise<void> => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
  const bindingOf = (id: string): Promise<string | null> =>
    page.evaluate(
      (cid) => (window as unknown as { __rectoCommands: { bindingFor: (i: string) => string | null } }).__rectoCommands.bindingFor(cid),
      id,
    )
  const saved = (): Record<string, string | null> => JSON.parse(fs.readFileSync(path.join(vault, '.recto', 'hotkeys.json'), 'utf8'))
  const shortcutsTab = async (): Promise<void> => {
    await page.keyboard.press('Meta+,')
    await page.waitForSelector('.settings-panel')
    await page.locator('.settings-panel .settings__tab', { hasText: 'Shortcuts' }).click()
  }

  it('a new binding works, is saved, and survives a reload', async () => {
    await shortcutsTab()
    await page.locator('[aria-label="Search shortcuts"]').fill('bold')
    await page.locator('[aria-label="Shortcut for Bold"]').click()
    await page.keyboard.press('Control+Alt+b')
    expect(saved()['editor:bold']).toBe('ctrl+alt+b')
    await page.keyboard.press('Escape')

    await page.reload()
    await page.waitForSelector('[role=treeitem]')
    await openNote()
    expect(await bindingOf('editor:bold')).toBe('ctrl+alt+b')
    // Select "plain" and bold it with the new keys.
    await page.locator('.cm-line', { hasText: 'paragraph to type' }).dblclick({ position: { x: 20, y: 5 } })
    await page.keyboard.press('Control+Alt+b')
    await expect.poll(() => fs.readFileSync(path.join(vault, 'Keys.md'), 'utf8'), { timeout: 5000 }).toContain('**')
  }, 60_000)

  it('a taken chord is asked about first; a chord macOS keeps is refused', async () => {
    await shortcutsTab()
    const search = page.locator('[aria-label="Search shortcuts"]')
    await search.fill('italic')
    await page.locator('[aria-label="Shortcut for Italic"]').click()
    await page.keyboard.press('Meta+k')
    // Nothing changed yet: it says what has the chord.
    const ask = page.locator('.hotkeys__ask')
    await ask.waitFor()
    expect(await ask.textContent()).toContain('Insert link')
    expect(await bindingOf('editor:italic')).toBe('Mod+I')
    await ask.getByRole('button', { name: /Use it here/ }).click()
    expect(await bindingOf('editor:italic')).toBe('meta+k')
    expect(await bindingOf('editor:link')).toBe(null)
    expect(saved()['editor:link']).toBe(null)

    await page.locator('[aria-label="Shortcut for Italic"]').click()
    await page.keyboard.press('Meta+Shift+4')
    expect(await page.locator('.hotkeys__ask').textContent()).toContain('kept by macOS for a macOS screenshot')
    expect(await bindingOf('editor:italic')).toBe('meta+k')

    // Back to the defaults for the loop below.
    await page.locator('.hotkeys__ask').getByRole('button', { name: 'OK' }).click()
    await search.fill('')
    await page.getByRole('button', { name: 'Reset all to defaults' }).click()
    expect(saved()).toEqual({})
    await page.keyboard.press('Escape')
  }, 60_000)

  it('the ⌘/ sheet lists the shortcuts, grouped', async () => {
    await inNote()
    await page.keyboard.press('Meta+/')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await sheet.waitFor()
    const heads = await sheet.locator('.shortcut-sheet__grouphead').allTextContents()
    expect(heads.slice(0, 4)).toEqual(['Editor', 'Formatting', 'Tables', 'Navigation'])
    expect(await sheet.textContent()).toContain('Insert table')
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'detached' })
  }, 20_000)

  it('every command with a binding runs from the keyboard', async () => {
    await page.reload()
    await page.waitForSelector('[role=treeitem]')
    await openNote()
    // Every command's action replaced by a recorder: pressing a key must reach
    // the right command, without the command then changing the screen.
    const rows = await page.evaluate(() => {
      const w = window as unknown as {
        __ran: string[]
        __rectoCommands: {
          list: () => { id: string; scope?: string; run: () => void }[]
          bindingFor: (id: string) => string | null
        }
      }
      w.__ran = []
      const out: { id: string; binding: string; scope: string }[] = []
      for (const command of w.__rectoCommands.list()) {
        command.run = () => {
          w.__ran.push(command.id)
        }
        const binding = w.__rectoCommands.bindingFor(command.id)
        if (binding !== null) out.push({ id: command.id, binding, scope: command.scope ?? 'app' })
      }
      return out
    })
    expect(rows.length).toBeGreaterThan(60)

    const missed: string[] = []
    const skipped: string[] = []
    for (const row of rows as Row[]) {
      if (row.scope === 'table') await inCell()
      else if (row.scope === 'editor') await inNote()
      else await nowhere()
      const available = await page.evaluate(
        (id) =>
          (window as unknown as { __rectoCommands: { get: (i: string) => { isAvailable?: () => boolean } | undefined } }).__rectoCommands
            .get(id)
            ?.isAvailable?.() ?? true,
        row.id,
      )
      if (!available) {
        skipped.push(row.id)
        continue
      }
      await page.evaluate(() => ((window as unknown as { __ran: string[] }).__ran = []))
      await page.keyboard.press(toKeys(row.binding))
      const ran = await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)
      if (ran[0] !== row.id) missed.push(`${row.id} (${row.binding}) ran ${JSON.stringify(ran)}`)
    }
    expect(missed).toEqual([])
    // Only what needs something on screen that this note doesn't have.
    expect(skipped).toEqual(['window:close-note-window'])
  }, 180_000)
})
