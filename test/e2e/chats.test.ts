import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quitApp, removeDir } from './helpers/app'

/**
 * The Chats panel, Canvas, the floating bot and Quick ask in the running app,
 * on a copy of the fixture vault: bots answer from the snapshot stand-in on
 * "this Mac", and the "cloud" is a fake Codex CLI (test/fixtures/fake-cli)
 * found through RECTO_CLI_DIRS, which writes down everything it was sent. So
 * the last tests can check that a note in an excluded folder never reaches a
 * cloud provider - from Quick ask or from the chat.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
/** In Kitchen/Sourdough.md, which is excluded from AI here. */
const MARKER = 'LEAK-MARKER-SOURDOUGH-7f3a'

type WithApi = { api: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }

describe.skipIf(!RUN)('chats, Canvas, the floating bot and Quick ask', { timeout: 40_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  let log = ''
  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    page.evaluate(([c, a]) => (window as unknown as WithApi).api.invoke(c as string, ...(a as unknown[])), [channel, args] as const)
  const topics = (): string[] => {
    const folder = path.join(vault, 'Recto/Chats/recto')
    return fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.md')) : []
  }
  const appearance = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(vault, '.recto/appearance.json'), 'utf8')) as Record<string, unknown>
  /** Ask in Quick ask once its provider says it is ready. */
  const ask = async (question: string): Promise<void> => {
    await page.locator('.quick-ask__input').fill(question)
    await page.waitForSelector('.quick-ask__send:not([disabled])')
    // A note just opened takes focus for its editor a moment later: back to the question.
    await page.waitForTimeout(300)
    await page.locator('.quick-ask__input').focus()
    await page.keyboard.press('Enter')
  }
  /** Main's jobs, polled from here: an async predicate in waitForFunction resolves at once. */
  const jobState = async (id: string): Promise<{ state: string; error: string | null } | undefined> =>
    ((await invoke('bots:jobs')) as { id: string; state: string; error: string | null }[]).find((j) => j.id === id)
  /** A note opened from the Data tree (`Kitchen/Sourdough` opens its folder first). */
  const open = async (name: string): Promise<void> => {
    const parts = name.split('/')
    // The innermost row whose own label is the name: a folder's row holds its children's text too.
    const row = (label: string) => page.locator('[role=treeitem]').filter({ has: page.getByText(label, { exact: true }) }).last()
    for (const folder of parts.slice(0, -1)) if ((await row(folder).getAttribute('aria-expanded')) !== 'true') await row(folder).click()
    await row(parts.at(-1)!).click()
    const title = parts.at(-1)!
    await page.waitForFunction((n) => document.querySelector('.tab.is-active')?.textContent?.includes(n) === true, title)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-chats-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    const bin = path.join(base, 'bin')
    log = path.join(base, 'cloud-log.json')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.appendFileSync(path.join(vault, 'Kitchen/Sourdough.md'), `\n\n${MARKER}\n`)
    fs.writeFileSync(path.join(vault, '.recto/ai-access.json'), JSON.stringify({ excluded: ['Kitchen'], writeMode: 'propose', cloud: true }))
    fs.mkdirSync(bin)
    fs.copyFileSync(path.join(ROOT, 'test/fixtures/fake-cli/fake-agent.mjs'), path.join(bin, 'codex'))
    fs.chmodSync(path.join(bin, 'codex'), 0o755)
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: bin, FAKE_LOG: log },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    await page.waitForFunction(
      async () => ((await (window as unknown as WithApi).api.invoke('index:search', 'basil', 5)) as unknown[]).length > 0,
      undefined,
      { timeout: 60_000 },
    )
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('Canvas is a section with its list of canvases and an empty page', async () => {
    await page.getByRole('tab', { name: 'Canvas' }).click()
    await page.waitForSelector('.canvas-empty__title')
    expect(await page.locator('.canvas-list .sidebar__empty').textContent()).toMatch(/No canvases yet/)
    expect(await page.getByRole('tab', { name: 'AI' }).count()).toBe(0)
    await page.keyboard.press('Meta+1')
    await page.waitForSelector('[role=treeitem]')
  })

  const closeChats = (): Promise<void> => page.getByRole('button', { name: 'Close chats' }).click()

  it('the tab bar’s button opens the Chats panel and hides while it is open; the panel’s own button and ⌘⇧C close it', async () => {
    await open('Handbook')
    await page.locator('.tabs__chats').click()
    await page.waitForSelector('.chats .bot-chat .composer__input')
    expect(await page.locator('.tabs__chats').count()).toBe(0)
    // Recto's chat right under the header: no list of bots above it.
    expect(await page.locator('.chats__head + .chats__chat').count()).toBe(1)
    expect(await page.locator('.chats__section:disabled').textContent()).toBe('People')
    await closeChats()
    await page.waitForSelector('.chats', { state: 'detached' })
    await page.waitForSelector('.tabs__chats')
    await page.keyboard.press('Meta+Shift+C')
    await page.waitForSelector('.chats')
    await page.keyboard.press('Meta+Shift+C')
    await page.waitForSelector('.chats', { state: 'detached' })
  })

  it('the panel and the graph take turns on the right', async () => {
    await page.getByRole('button', { name: 'Toggle graph' }).click()
    await page.waitForSelector('.float[aria-label="Graph"]')
    await page.locator('.tabs__chats').click()
    await page.waitForSelector('.chats')
    expect(await page.locator('.float[aria-label="Graph"]').count()).toBe(0)
    await closeChats()
    await page.waitForSelector('.float[aria-label="Graph"]')
    await page.locator('.tabs__chats').click()
    await page.waitForSelector('.chats')
    await page.getByRole('button', { name: 'Toggle graph' }).click()
    await page.waitForSelector('.chats', { state: 'detached' })
    await page.getByRole('button', { name: 'Toggle graph' }).click()
    await page.waitForSelector('.float[aria-label="Graph"]', { state: 'detached' })
  })

  it('⌘⇧B shows the floating bot; dragged, it snaps to the nearest edge and is remembered; again, it goes', async () => {
    await page.keyboard.press('Meta+Shift+B')
    const bot = page.locator('.floating-bot.is-settled')
    await bot.waitFor()
    expect(await bot.getAttribute('data-edge')).toBe('right')
    const area = (await page.locator('.shell__content').boundingBox())!
    const box = (await bot.boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(area.x + 60, area.y + area.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.floating-bot')?.getAttribute('data-edge') === 'left', undefined, { timeout: 5000 })
    // Appearance is saved a moment after it changes.
    await page.waitForTimeout(900)
    expect(appearance()).toMatchObject({ floatingBot: true, botPlace: { edge: 'left' } })
    await page.keyboard.press('Meta+Shift+B')
    await page.waitForSelector('.floating-bot', { state: 'detached' })
    await page.keyboard.press('Meta+Shift+B')
    await bot.waitFor()
    expect(await bot.getAttribute('data-edge')).toBe('left')
  })

  it('Quick ask asks about the open note, marks a switch of note, and is never saved as a chat', async () => {
    const before = topics().length
    await open('Handbook')
    await page.locator('.floating-bot').click()
    await page.waitForSelector('.quick-ask .quick-ask__input')
    // A bubble out of the bot, beside it - never over it.
    const bubble = (await page.locator('.quick-ask').boundingBox())!
    const face = (await page.locator('.floating-bot').boundingBox())!
    const apart =
      bubble.y + bubble.height <= face.y || face.y + face.height <= bubble.y || bubble.x + bubble.width <= face.x || face.x + face.width <= bubble.x
    expect(apart).toBe(true)
    await ask('What is this note for?')
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length === 1)
    expect(await page.locator('.quick-ask__about').allTextContents()).toEqual(['About: Handbook'])

    await open('Ideas')
    await ask('And this one?')
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length === 2)
    expect(await page.locator('.quick-ask__input').getAttribute('placeholder')).toBe('Anything else you’d like to know?')
    expect(await page.locator('.quick-ask__about').allTextContents()).toEqual(['About: Handbook', 'About: Ideas'])
    expect(topics().length).toBe(before)

    // Closed, it forgets the thread.
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()
    await page.locator('.floating-bot').click()
    await page.waitForSelector('.quick-ask .quick-ask__input')
    expect(await page.locator('.quick-ask__turn').count()).toBe(0)
    expect(topics().length).toBe(before)
  })

  it('Quick ask’s bubble moves with the bot while it is dragged', async () => {
    // Left open by the last test, and left open for the next.
    await page.waitForSelector('.quick-ask .quick-ask__input')
    const face = (await page.locator('.floating-bot').boundingBox())!
    const bubble = (await page.locator('.quick-ask').boundingBox())!
    await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2)
    await page.mouse.down()
    // From the left edge, where the last test left it, 120 px towards the middle.
    expect(await page.locator('.floating-bot').getAttribute('data-edge')).toBe('left')
    await page.mouse.move(face.x + face.width / 2 + 120, face.y + face.height / 2, { steps: 6 })
    // Still held: the bubble has gone the same way.
    const moved = (await page.locator('.quick-ask').boundingBox())!
    expect(Math.round(moved.x - bubble.x)).toBe(120)
    await page.mouse.up()
    await page.waitForSelector('.quick-ask .quick-ask__input')
  })

  it('“Save as chat” makes the thread a normal chat with Recto, open in the panel', async () => {
    const before = topics()
    await ask('Summarise it')
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length === 1)
    await page.getByRole('button', { name: 'Save as chat' }).click()
    await page.waitForSelector('.quick-ask', { state: 'detached' })
    await page.waitForSelector('.chats .bot-chat .msg--bot')
    const added = topics().filter((t) => !before.includes(t))
    expect(added).toHaveLength(1)
    const text = fs.readFileSync(path.join(vault, 'Recto/Chats/recto', added[0]!), 'utf8')
    expect(text).toContain('Summarise it')
    expect(text).toContain('Your notes keep the soil mix simple')
    await closeChats()
  })

  it('the tab bar’s + opens a new tab to open a note or make one; the status bar’s bot shows and hides the floating bot', async () => {
    const notes = (): number => fs.readdirSync(vault).filter((f) => f.endsWith('.md')).length
    const before = notes()
    const tabs = await page.locator('.tab').count()
    await page.locator('.tabs__new').first().click()
    await page.waitForSelector('.new-tab .new-tab__input')
    expect(await page.locator('.tab.is-active').getAttribute('aria-label')).toBe('New tab')
    expect(await page.locator('.new-tab__row').first().textContent()).toContain('New note')
    expect(notes()).toBe(before)

    // A name no note has: "Create “…”" on top, Enter makes it, here in this tab.
    await page.locator('.new-tab__input').fill('Fresh idea')
    expect(await page.locator('.new-tab__row').first().textContent()).toContain('Create “Fresh idea”')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('aria-label') === 'Fresh idea')
    expect(fs.existsSync(path.join(vault, 'Fresh idea.md'))).toBe(true)
    expect(await page.locator('.tab').count()).toBe(tabs + 1)

    // An existing note: picked from the list, it opens in the new tab's place.
    await page.locator('.tabs__new').first().click()
    await page.locator('.new-tab__input').fill('Handbook')
    expect(await page.locator('.new-tab__row').first().textContent()).toContain('Handbook')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('aria-label') === 'Handbook')
    expect(await page.locator('.tab').count()).toBe(tabs + 2)
    expect(notes()).toBe(before + 1)

    await page.getByRole('button', { name: 'Toggle the floating bot' }).click()
    await page.waitForSelector('.floating-bot', { state: 'detached' })
    await page.getByRole('button', { name: 'Toggle the floating bot' }).click()
    await page.waitForSelector('.floating-bot.is-settled')
  })

  it('in Data the new tab lists only notes; in Tasks only boards, and makes a board', async () => {
    await page.locator('.tabs__new').first().click()
    await page.waitForSelector('.new-tab__input')
    const dataRows = await page.locator('.new-tab__row .new-tab__folder').allTextContents()
    expect(dataRows.some((f) => f.startsWith('Recto'))).toBe(false)
    await page.locator('.tab.is-active .tab__close').click()

    await page.getByRole('tab', { name: 'Tasks' }).click()
    await page.locator('.tabs__new').first().click()
    await page.waitForSelector('.new-tab__input')
    expect(await page.locator('.new-tab__heading').textContent()).toBe('Boards')
    await page.locator('.new-tab__input').fill('Roadmap')
    expect(await page.locator('.new-tab__row').first().textContent()).toContain('Create “Roadmap”')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.tab.is-active')?.getAttribute('aria-label') === 'Roadmap')
    await page.waitForSelector('.board')
    await page.keyboard.press('Meta+1')
    await page.waitForSelector('[role=treeitem]')
  })

  it('on a board the floating bot sits on a frosted disc that blurs the cards behind it; back in Data it is plain, where it was', async () => {
    // Where it stands once the page has settled: a view just switched to may still be laying out its bars.
    let before = (await page.locator('.floating-bot').boundingBox())!
    await expect
      .poll(async () => {
        const now = (await page.locator('.floating-bot').boundingBox())!
        const still = now.x === before.x && now.y === before.y
        before = now
        return still
      })
      .toBe(true)
    expect(await page.locator('.floating-bot.is-frosted').count()).toBe(0)
    await page.getByRole('tab', { name: 'Tasks' }).click()
    await page.waitForSelector('.board')
    await page.waitForSelector('.floating-bot.is-frosted')
    const disc = await page.locator('.floating-bot.is-frosted').evaluate((el) => getComputedStyle(el, '::before').backdropFilter)
    expect(disc).toContain('blur')
    await page.keyboard.press('Meta+1')
    await page.waitForSelector('.floating-bot:not(.is-frosted)')
    await page.waitForTimeout(300)
    expect(await page.locator('.floating-bot').boundingBox()).toEqual(before)
  })

  it('the bot stands only along the note’s left, right and bottom edges: never on the bars above or Linked mentions below', async () => {
    await open('Handbook')
    await page.waitForSelector('.backlinks')
    // Dropped right on the bar, it settles above it.
    const bar = (await page.locator('.backlinks').boundingBox())!
    const face = (await page.locator('.floating-bot').boundingBox())!
    await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2)
    await page.mouse.down()
    await page.mouse.move(bar.x + bar.width - 40, bar.y + bar.height - 10, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.floating-bot')?.getAttribute('data-edge') === 'bottom', undefined, { timeout: 5000 })
    await page.waitForFunction(() => {
      const bot = document.querySelector('.floating-bot')?.getBoundingClientRect()
      const bar = document.querySelector('.backlinks')?.getBoundingClientRect()
      return bot !== undefined && bar !== undefined && bot.bottom <= bar.top
    }, undefined, { timeout: 5000 })

    // Dropped on the tab bar, it goes to the nearest side edge, below the arrows' row.
    const tabs = (await page.locator('.tabs__bar').first().boundingBox())!
    const now = (await page.locator('.floating-bot').boundingBox())!
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2)
    await page.mouse.down()
    await page.mouse.move(tabs.x + tabs.width - 60, tabs.y + 10, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.floating-bot')?.getAttribute('data-edge') === 'right', undefined, { timeout: 5000 })
    await page.waitForFunction(() => {
      const bot = document.querySelector('.floating-bot')?.getBoundingClientRect()
      const row = document.querySelector('.md__bar')?.getBoundingClientRect()
      return bot !== undefined && row !== undefined && bot.top >= row.bottom
    }, undefined, { timeout: 5000 })

    // High on the side, it stays put while Linked mentions opens and closes under it.
    await page.waitForTimeout(400)
    const still = (await page.locator('.floating-bot').boundingBox())!
    await page.locator('.backlinks__head').click()
    await page.waitForTimeout(600)
    expect((await page.locator('.floating-bot').boundingBox())!.y).toBe(still.y)
    await page.locator('.backlinks__head').click()
    await page.waitForTimeout(600)
    expect((await page.locator('.floating-bot').boundingBox())!.y).toBe(still.y)

    // On the bottom edge it rides on the bar, in step with it: no lag behind the bar opening or closing.
    const low = (await page.locator('.floating-bot').boundingBox())!
    const content = (await page.locator('.shell__content').boundingBox())!
    await page.mouse.move(low.x + low.width / 2, low.y + low.height / 2)
    await page.mouse.down()
    await page.mouse.move(content.x + content.width / 2, (await page.locator('.backlinks').boundingBox())!.y - 30, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.floating-bot')?.getAttribute('data-edge') === 'bottom', undefined, { timeout: 5000 })
    await page.waitForTimeout(400)
    for (let i = 0; i < 2; i++) {
      const clear = await page.evaluate(async () => {
        ;(document.querySelector('.backlinks__head') as HTMLElement).click()
        for (let f = 0; f < 2; f++) await new Promise(requestAnimationFrame)
        const bot = document.querySelector('.floating-bot')!.getBoundingClientRect()
        const bar = document.querySelector('.backlinks')!.getBoundingClientRect()
        return bar.top - bot.bottom
      })
      expect(clear).toBeGreaterThanOrEqual(0)
      expect(clear).toBeLessThan(30)
    }
  })

  it('on a page without Linked mentions the bot goes down to the bottom, and back above the bar on a note - in the next frame', async () => {
    await open('Handbook')
    if ((await page.locator('.backlinks:not(.is-collapsed)').count()) > 0) await page.locator('.backlinks__head').click()
    // On the bottom edge, where the bar makes a difference.
    const face = (await page.locator('.floating-bot').boundingBox())!
    const content = (await page.locator('.shell__content').boundingBox())!
    await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2)
    await page.mouse.down()
    await page.mouse.move(content.x + content.width / 2, (await page.locator('.backlinks').boundingBox())!.y - 30, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.floating-bot')?.getAttribute('data-edge') === 'bottom')
    await page.waitForTimeout(400)
    const gap = async (): Promise<number> =>
      page.evaluate(async () => {
        for (let f = 0; f < 2; f++) await new Promise(requestAnimationFrame)
        const bot = document.querySelector('.floating-bot')!.getBoundingClientRect()
        const area = document.querySelector('.shell__content')!.getBoundingClientRect()
        return area.bottom - bot.bottom
      })
    const onNote = await gap()
    await page.locator('.tabs__new').first().click()
    const onNewTab = await gap()
    expect(onNewTab).toBeLessThan(onNote)
    expect(onNewTab).toBeLessThan(30)
    await page.locator('.tab.is-active .tab__close').click()
    // Back on the note: the bar loads with it, and the bot is above it in the frame after.
    await page.waitForSelector('.backlinks')
    expect(await gap()).toBe(onNote)
  })

  it('the AI guide is picked by typing its name, from notes only', async () => {
    await page.keyboard.press('Meta+,')
    await page.waitForSelector('.settings-panel')
    await page.locator('.settings-panel .settings__tab', { hasText: 'AI' }).click()
    await page.locator('.note-picker__button').click()
    // The list is drawn over the settings card, not clipped by it: its first row is what is under the pointer there.
    const shown = await page.evaluate(() => {
      const row = document.querySelector('.note-picker__row')!.getBoundingClientRect()
      return document.elementFromPoint(row.x + row.width / 2, row.y + row.height / 2)?.closest('.note-picker__row') !== null
    })
    expect(shown).toBe(true)
    // Recto's own files - the chats saved by the tests above - are not offered.
    expect(topics().length).toBeGreaterThan(0)
    const folders = await page.locator('.note-picker__folder').allTextContents()
    expect(folders.some((f) => f.startsWith('Recto'))).toBe(false)
    await page.locator('.note-picker__input').fill('Handb')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('.note-picker__button').textContent()).toContain('Handbook')
    await expect
      .poll(() => (JSON.parse(fs.readFileSync(path.join(vault, '.recto/ai-access.json'), 'utf8')) as { guide?: string }).guide)
      .toBe('Handbook.md')
    await page.locator('.settings-panel').getByRole('button', { name: 'Close settings' }).click()
    await page.waitForSelector('.settings-panel', { state: 'detached' })
  })

  it('the picker groups the cloud by maker; Codex’s page shows its plan’s limits, read for free', async () => {
    await page.locator('.tabs__chats').click()
    await page.locator('.chats .composer__chip').click()
    await page.locator('.glass-menu__item', { hasText: 'OpenAI' }).click()
    await page.waitForSelector('.glass-menu__note')
    expect(await page.locator('.glass-menu__head').allTextContents()).toEqual(expect.arrayContaining(['Codex', 'ChatGPT plan · Preview', 'API key']))
    expect(await page.locator('.glass-menu__note').allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^6% of 30 days used/)]))
    await page.keyboard.press('Escape')
    await closeChats()
  })

  it('a cloud provider never receives text from an excluded folder: Quick ask', async () => {
    // Handbook links to Sourdough, in Kitchen/ - its summary must not go with the note.
    await page.evaluate(() => localStorage.setItem('recto.quickAskModel', 'codex'))
    await open('Handbook')
    await page.locator('.floating-bot').click()
    await page.waitForSelector('.quick-ask .composer__where.is-cloud')
    await ask('What does it link to?')
    await page.waitForFunction(() => document.querySelector('.quick-ask__a .bot-md')?.textContent?.includes('compost') === true, undefined, {
      timeout: 20_000,
    })
    const sent = JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string; args: string[] }
    expect(sent.prompt).toContain('A long note that exercises the editor')
    expect(sent.prompt).not.toContain(MARKER)
    expect(sent.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()

    // A note inside the excluded folder: refused before anything is sent.
    fs.rmSync(log)
    await open('Kitchen/Sourdough')
    await page.locator('.floating-bot').click()
    await ask('Anything?')
    await page.waitForSelector('.quick-ask .is-excluded')
    expect(fs.existsSync(log)).toBe(false)
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()
  })


  it('Quick ask on a canvas: the canvas - or what is selected - goes with the question, never a note AI may not see', async () => {
    fs.mkdirSync(path.join(vault, 'Recto/Canvas'), { recursive: true })
    const node = (id: string, x: number, rest: Record<string, unknown>) => ({ id, x, y: 0, width: 200, height: 120, ...rest })
    fs.writeFileSync(
      path.join(vault, 'Recto/Canvas/Ask here.canvas'),
      JSON.stringify({
        nodes: [
          node('a1b2c3d4e5f60001', 0, { type: 'text', text: 'Water daily in summer' }),
          node('a1b2c3d4e5f60002', 400, { type: 'file', file: 'Garden/Basil.md' }),
          node('a1b2c3d4e5f60003', 800, { type: 'file', file: 'Kitchen/Sourdough.md' }),
        ],
        edges: [{ id: 'a1b2c3d4e5f60009', fromNode: 'a1b2c3d4e5f60001', toNode: 'a1b2c3d4e5f60002', label: 'for' }],
      }),
    )
    await page.evaluate(() => localStorage.setItem('recto.quickAskModel', 'codex'))
    await page.getByRole('tab', { name: 'Canvas' }).click()
    await page.locator('.boards__row', { hasText: 'Ask here' }).click()
    await page.waitForSelector('.react-flow__node')
    await page.locator('.floating-bot').click()
    await page.waitForSelector('.quick-ask .quick-ask__input:not([disabled])')
    expect(await page.locator('.quick-ask__input').getAttribute('placeholder')).toBe('Ask anything about this canvas…')
    await ask('What is on it?')
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length >= 1, undefined, { timeout: 20_000 })
    let sent = JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string }
    expect(sent.prompt).toContain('The whole canvas “Ask here”')
    expect(sent.prompt).toContain('- card “Water daily in summer” → note “Basil” (“for”)')
    expect(sent.prompt).toContain('A note AI may not see')
    expect(sent.prompt).not.toContain(MARKER)
    // Not even named on the canvas (the AI guide note may link it by name: that is the guide's text, not the canvas's).
    expect(sent.prompt).not.toContain('note “Sourdough”')
    expect(await page.locator('.quick-ask__about').allTextContents()).toEqual(['About: Ask here'])
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()

    // One card selected: only it goes.
    await page.locator('.react-flow__node[data-id="a1b2c3d4e5f60001"]').click()
    await page.locator('.floating-bot').click()
    await page.waitForSelector('.quick-ask .quick-ask__input:not([disabled])')
    expect(await page.locator('.quick-ask__note').textContent()).toBe('1 selected on Ask here')
    await ask('And this?')
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length >= 1, undefined, { timeout: 20_000 })
    sent = JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string }
    expect(sent.prompt).toContain('1 selected on the canvas “Ask here”')
    expect(sent.prompt).not.toContain('note “Basil”')
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()

    // A canvas command: "Group these" on two selected cards asks Quick ask, naming them as the canvas tools do.
    await page.locator('.react-flow__node[data-id="a1b2c3d4e5f60001"]').click()
    await page.locator('.react-flow__node[data-id="a1b2c3d4e5f60002"]').click({ modifiers: ['Shift'] })
    await page.locator('.react-flow__node[data-id="a1b2c3d4e5f60001"]').click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Group these' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.quick-ask__a .bot-md').length >= 1, undefined, { timeout: 20_000 })
    sent = JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string }
    expect(sent.prompt).toContain('Group the selected nodes (n1, n2)')
    expect(sent.prompt).toContain('2 selected on the canvas “Ask here”')
    await page.locator('.quick-ask').getByRole('button', { name: /Close Quick ask/ }).click()
    await page.keyboard.press('Meta+1')
  })
  it('a cloud provider never receives text from an excluded folder: the chat, after a switch from this Mac', async () => {
    // An earlier answer on this Mac that read Sourdough, then the chat switches to Codex.
    const folder = path.join(vault, 'Recto/Chats/recto')
    const file = path.join(folder, '2026-09-20 08-00 — Bread.md')
    const meta = (fields: object): string => `<!-- recto:meta ${JSON.stringify(fields)} -->`
    fs.writeFileSync(
      file,
      [
        '---\nbot: recto\ncreated: 2026-09-20T08:00:00\ntitle: Bread\n---\n',
        '## You\n\nWhat is in my starter?\n',
        meta({ at: '2026-09-20T08:00:00' }),
        `\n## Recto\n\nYour starter note says ${MARKER}.\n`,
        meta({ at: '2026-09-20T08:00:10', model: 'qwen3.5:9b', sources: [{ path: 'Kitchen/Sourdough.md', heading: null }] }),
        '',
      ].join('\n'),
    )
    await page.waitForTimeout(500)
    await invoke('bots:set-model', 'recto', 'codex')
    const sent = (await invoke('bots:send', { botId: 'recto', topic: 'Recto/Chats/recto/2026-09-20 08-00 — Bread.md', text: 'Thanks, and for rye?' })) as {
      ok: boolean
      job?: { id: string }
    }
    expect(sent.ok).toBe(true)
    const until = Date.now() + 20_000
    while (!['done', 'error'].includes((await jobState(sent.job!.id))?.state ?? '') && Date.now() < until) await page.waitForTimeout(200)
    expect(await jobState(sent.job!.id)).toMatchObject({ state: 'done' })
    const prompt = (JSON.parse(fs.readFileSync(log, 'utf8')) as { prompt: string }).prompt
    expect(prompt).toContain('Thanks, and for rye?')
    expect(prompt).toContain('What is in my starter?')
    expect(prompt).not.toContain(MARKER)
    const saved = fs.readFileSync(file, 'utf8')
    expect(saved).toContain('"model":"codex"')
    await invoke('bots:set-model', 'recto', null)
  })
})
