import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makePdf } from '../fixtures/make-pdf'

/** A drawing's strokes as kept in its SVG: kind, colour and size. */
const fromSvgStrokes = (svg: string): { kind?: string; color: string | null; size: number }[] =>
  (JSON.parse(svg.match(/<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/)![1]!) as { kind?: string; color: string | null; size: number }[]).map(({ kind, color, size }) => ({ ...(kind === undefined ? {} : { kind }), color, size }))
import { quitApp, removeDir } from './helpers/app'

/**
 * Canvas in the running app, on a copy of the fixture vault with a canvas in
 * it written the way Obsidian writes one: open, draw, edit, undo, copy and
 * paste, make a note and a link, follow a rename, keep a deleted note's place,
 * mark a card done from the canvas, the graph and the backlinks.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')
// Where Recto keeps canvases (recto-paths.ts).
const PLAN = 'Recto/Canvas/Garden plan.canvas'

type WithApi = { api: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }

/** The fixture, with notes from this vault and a card from its board on it. */
function planText(): string {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/canvas/garden.canvas'), 'utf8')) as {
    nodes: Record<string, unknown>[]
    edges: Record<string, unknown>[]
    metadata: unknown
  }
  const nodes = [
    ...base.nodes.filter((n) => n['id'] !== '5e4d3c2b1a090807'),
    { id: 'a0b0c0d0e0f00011', type: 'file', file: 'Garden/Tomatoes.md', x: 600, y: 400, width: 300, height: 240 },
    { id: 'a0b0c0d0e0f00022', type: 'file', file: 'Recto/Boards/Launch/Record the demo.md', x: 1000, y: 400, width: 260, height: 160 },
    // Straight below Soil, so the edge between them is a straight line.
    { id: 'a0b0c0d0e0f00044', type: 'file', file: 'Garden/Basil.md', x: -140, y: 900, width: 260, height: 200 },
  ]
  const edges = [
    ...base.edges,
    { id: 'b0b0b0b0b0b00033', fromNode: '0f9e8d7c6b5a4932', toNode: 'a0b0c0d0e0f00011' },
    { id: 'b0b0b0b0b0b00055', fromNode: 'a0b0c0d0e0f00044', fromSide: 'top', toNode: '0f9e8d7c6b5a4932', toSide: 'bottom' },
  ]
  const line = (o: unknown): string => `\t\t${JSON.stringify(o)}`
  return `{\n\t"nodes":[\n${nodes.map(line).join(',\n')}\n\t],\n\t"edges":[\n${edges.map(line).join(',\n')}\n\t],\n\t"metadata":${JSON.stringify(base.metadata)}\n}`
}

describe.skipIf(!RUN)('canvas', { timeout: 40_000 }, () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    page.evaluate(([c, a]) => (window as unknown as WithApi).api.invoke(c as string, ...(a as unknown[])), [channel, args] as const)
  const read = (p: string): string => fs.readFileSync(path.join(vault, p), 'utf8')
  /** A node by its id in the file: what it shows depends on the zoom. */
  // In the first canvas on screen: a test may have opened a second pane beside it.
  const nodeOf = (id: string) => page.locator('.canvas-view').first().locator(`.react-flow__node[data-id="${id}"]`)

  const openPlan = async (): Promise<void> => {
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Canvas' }).click()
    await page.locator('.canvas-list .boards__name', { hasText: 'Garden plan' }).click()
    await page.waitForSelector('.react-flow__node')
    await page.waitForTimeout(400)
  }

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-canvas-'))
    vault = path.join(base, 'vault')
    const profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    // Links follow renames without asking ("Always update" chosen once); the question itself is tested in rename-links.test.ts.
    fs.mkdirSync(path.join(vault, '.recto'), { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'link-settings.json'), JSON.stringify({ alwaysUpdateLinks: true }))
    fs.mkdirSync(path.dirname(path.join(vault, PLAN)), { recursive: true })
    fs.writeFileSync(path.join(vault, PLAN), planText())
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1', RECTO_BOTS_MOCK: '1', RECTO_CLI_DIRS: '/nonexistent' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    // The index has the canvas once it can say which canvases a note is on.
    for (let tries = 0; tries < 120; tries++) {
      if (((await invoke('index:canvases-of', 'Garden/Soil.md')) as string[]).includes(PLAN)) break
      await page.waitForTimeout(250)
    }
  }, 120_000)

  afterAll(async () => {
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('lists canvases in the Canvas section and draws one, a plugin’s node kept and named', async () => {
    await openPlan()
    expect(await page.locator('.canvas-view__name').textContent()).toBe('Garden plan')
    expect(await page.locator('.canvas-node--group .canvas-group__label').textContent()).toBe('Garden')
    expect(await page.locator('.canvas-note__title', { hasText: /^Tomatoes$/ }).count()).toBe(1)
    expect(await page.locator('.canvas-node--unknown').textContent()).toContain('excalidraw')
    // A file node is drawn as a card only once the boards have loaded, a moment after the rest.
    await expect.poll(() => page.locator('.canvas-node--card').count()).toBe(1)
  })

  it('a moved node is a one-line change, every key Recto does not know kept', async () => {
    const before = read(PLAN).split('\n')
    const box = (await nodeOf('1234abcd5678ef90').boundingBox())!
    await page.mouse.move(box.x + 30, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(box.x + 130, box.y + 80, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => read(PLAN)).not.toBe(before.join('\n'))
    const after = read(PLAN).split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((l, i) => l !== before[i])
    expect(changed).toHaveLength(1)
    expect(changed[0]).toContain('"styleAttributes":{"shape":"pill"}')
    expect(read(PLAN)).toContain('"type":"excalidraw","x":200,"y":120,"width":200,"height":120,"drawing":"abc"')
    expect(read(PLAN)).toContain('"metadata":{"version":"1.0-1.0","frontmatter":{}}')
  })

  it('double-click makes a text node, typed text is saved; ⌘Z takes it away and ⇧⌘Z brings it back', async () => {
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.dblclick(pane.x + pane.width - 160, pane.y + pane.height - 120)
    await page.waitForSelector('.canvas-node .cm-editor')
    await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
    // The editor is the node itself: no border of its own, no scroller capped inside the node's.
    const box = await page.locator('.canvas-node .note-body').evaluate((el) => {
      const scroller = getComputedStyle(el.querySelector('.cm-scroller')!)
      return { border: getComputedStyle(el).borderTopWidth, maxHeight: scroller.maxHeight, overflow: scroller.overflowY }
    })
    expect(box).toEqual({ border: '0px', maxHeight: 'none', overflow: 'visible' })
    await page.keyboard.type('Mulch in autumn')
    await page.keyboard.press('Escape')
    await expect.poll(() => read(PLAN)).toContain('"text":"Mulch in autumn"')
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(PLAN)).not.toContain('Mulch in autumn')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(PLAN).includes('"text":""')).toBe(false)
    await page.keyboard.press('Meta+Shift+z')
    await page.keyboard.press('Meta+Shift+z')
    await expect.poll(() => read(PLAN)).toContain('"text":"Mulch in autumn"')
  })

  it('copies nodes to another canvas, with new ids', async () => {
    await nodeOf('1234abcd5678ef90').click()
    await page.keyboard.press('Meta+c')
    // A new canvas, beside this one.
    await page.locator('.canvas-list .boards__add').click()
    await page.locator('[aria-label="New canvas name"]').fill('Second plan')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.canvas-view__name')?.textContent === 'Second plan')
    expect(fs.existsSync(path.join(vault, 'Recto/Canvas/Second plan.canvas'))).toBe(true)
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Meta+v')
    await expect.poll(() => read('Recto/Canvas/Second plan.canvas')).toContain('"text":"Plugin node"')
    expect(read('Recto/Canvas/Second plan.canvas')).not.toContain('1234abcd5678ef90')
  })

  it('“Make it a note” makes the text a note in the canvas’s folder and puts it in the node’s place', async () => {
    await openPlan()
    await nodeOf('a1b2c3d4e5f60718').click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Make it a note' }).click()
    await page.locator('[aria-label="Note name"]').fill('Soil recipe')
    await page.keyboard.press('Enter')
    // The heading line was its title; the rest is its text.
    // Not into Recto/ with the canvas: your notes go to the vault's top unless you choose a folder.
    await expect.poll(() => (fs.existsSync(path.join(vault, 'Soil recipe.md')) ? read('Soil recipe.md') : null)).toBe('Compost, loam and **grit**.\n')
    await expect.poll(() => read(PLAN)).toContain('"id":"a1b2c3d4e5f60718","type":"file","x":-440,"y":-240,"width":260,"height":140,"file":"Soil recipe.md"')
  })

  it('“Make it a link” on an edge between two notes waits as a Suggested edit; an edge already a link is marked', async () => {
    await page.locator('.canvas-view__bar .board__tool', { hasText: 'Zoom to fit' }).click()
    await page.waitForTimeout(400)
    // Soil links to Tomatoes in its text: that edge carries the link mark.
    await page.waitForSelector('.canvas-edge__link')
    const before = ((await invoke('ai-proposals:list')) as unknown[]).length
    // Basil does not link to Soil yet.
    // Right on the line between them: halfway from Basil's top to Soil's bottom.
    const titled = (name: string) => page.locator('.canvas-node--note').filter({ has: page.locator('.canvas-note__title', { hasText: new RegExp(`^${name}$`) }) })
    const soil = (await titled('Soil').boundingBox())!
    const basil = (await titled('Basil').boundingBox())!
    await page.mouse.click(soil.x + soil.width / 2, (soil.y + soil.height + basil.y) / 2, { button: 'right' })
    await page.locator('.menu__item', { hasText: 'Make it a link' }).click()
    await expect.poll(async () => ((await invoke('ai-proposals:list')) as unknown[]).length).toBe(before + 1)
    const proposal = ((await invoke('ai-proposals:list')) as { files: { path: string; after: string }[] }[])[0]!
    expect(proposal.files[0]!.path).toBe('Garden/Basil.md')
    expect(proposal.files[0]!.after).toContain('[[Soil]]')
    // Nothing is written before Apply.
    expect(read('Garden/Basil.md')).not.toContain('[[Soil]]')
    // The Suggested edits dialog opens once the proposal is in; shut it.
    await page.waitForSelector('.dialog__backdrop')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.dialog__backdrop', { state: 'detached' })
  })

  it('a note says which canvases it is on, in its Linked mentions', async () => {
    await page.keyboard.press('Meta+1')
    // Opened only if shut: a second click would shut it again.
    if ((await page.locator('[role=treeitem]', { hasText: 'Tomatoes' }).count()) === 0) await page.locator('[role=treeitem]', { hasText: 'Garden' }).first().click()
    await page.locator('[role=treeitem]', { hasText: 'Tomatoes' }).last().click()
    await page.waitForSelector('.backlinks')
    if ((await page.locator('.backlinks.is-collapsed').count()) > 0) await page.locator('.backlinks__head').click()
    await expect.poll(() => page.locator('.backlinks__list').textContent()).toContain('On canvas Garden plan')
  })

  it('a renamed note is followed on the canvas; a deleted one keeps its place, marked', async () => {
    const renamed = (await invoke('fs:rename', 'Garden/Tomatoes.md', 'Tomato plants.md')) as { ok: boolean }
    expect(renamed.ok).toBe(true)
    await expect.poll(() => read(PLAN)).toContain('"file":"Garden/Tomato plants.md"')
    expect(read(PLAN)).not.toContain('"file":"Garden/Tomatoes.md"')
    await invoke('fs:trash', 'Garden/Tomato plants.md')
    await openPlan()
    await page.waitForSelector('.canvas-node--note.is-missing')
    expect(read(PLAN)).toContain('"file":"Garden/Tomato plants.md"')
  })

  it('a card marked done on the canvas moves to Done on its board', async () => {
    await page.locator('.canvas-node--card').click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Mark done' }).click()
    await expect.poll(() => {
      const board = read('Recto/Boards/Launch/Launch.md')
      return board.slice(board.indexOf('## Done')).includes('[[Record the demo]]')
    }).toBe(true)
  })

  it('the graph has the canvas as a node, tied to the notes on it', async () => {
    const graph = (await invoke('index:graph')) as { nodes: { path: string; canvas?: boolean }[]; edges: { source: string; target: string; member?: boolean }[] }
    expect(graph.nodes.find((n) => n.path === PLAN)?.canvas).toBe(true)
    expect(graph.edges.some((e) => e.source === PLAN && e.target === 'Garden/Soil.md' && e.member === true)).toBe(true)
  })

  it('a file dropped from Finder is copied into attachments and put on the canvas', async () => {
    await page.evaluate(() => {
      const plane = document.querySelector('.canvas-view__plane')!
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'sketch.png', { type: 'image/png' }))
      const rect = plane.getBoundingClientRect()
      const at = { clientX: rect.left + 200, clientY: rect.top + 200, bubbles: true, cancelable: true, dataTransfer: data }
      plane.dispatchEvent(new DragEvent('dragover', at))
      plane.dispatchEvent(new DragEvent('drop', at))
    })
    await expect.poll(() => fs.existsSync(path.join(vault, 'attachments/sketch.png'))).toBe(true)
    await expect.poll(() => read(PLAN)).toContain('"file":"attachments/sketch.png"')
  })

  it('a canvas in the list is renamed and archived from its right-click menu, as a note is in Data', async () => {
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Canvas' }).click()
    await page.locator('.canvas-list .boards__add').click()
    await page.locator('[aria-label="New canvas name"]').fill('Scratch board')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.canvas-view__name')?.textContent === 'Scratch board')
    const made = fs.readdirSync(vault, { recursive: true }).map(String).find((f) => f.endsWith('Scratch board.canvas'))!
    await page.locator('.canvas-list .boards__name', { hasText: 'Scratch board' }).click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Rename' }).click()
    await page.locator('[aria-label="Canvas name"]').fill('Scratch plan')
    await page.keyboard.press('Enter')
    const renamed = made.replace('Scratch board', 'Scratch plan')
    await expect.poll(() => fs.existsSync(path.join(vault, renamed))).toBe(true)
    expect(fs.existsSync(path.join(vault, made))).toBe(false)
    await page.locator('.canvas-list .boards__name', { hasText: 'Scratch plan' }).click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Move to archive' }).click()
    await page.getByRole('button', { name: 'Move to archive' }).click()
    await expect.poll(() => fs.existsSync(path.join(vault, renamed))).toBe(false)
    await expect.poll(() => page.locator('.canvas-list .boards__name', { hasText: 'Scratch plan' }).count()).toBe(0)
  })

  it('the Arrow tool pins an arrow at both centres; one let go in the open ends free; its middle bends it; deleted, its free end goes', async () => {
    await openPlan()
    await page.locator('.board__tool', { hasText: 'Zoom to fit' }).click()
    await page.waitForTimeout(200)
    const centre = async (id: string): Promise<{ x: number; y: number }> => {
      const b = (await nodeOf(id).boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 8 })
      await page.mouse.up()
    }
    const edges = (): Record<string, unknown>[] => (JSON.parse(read(PLAN)) as { edges: Record<string, unknown>[] }).edges
    const before = edges().length

    await page.locator('.canvas-view').focus()
    await page.keyboard.press('a')
    await drag(await centre('a0b0c0d0e0f00022'), await centre('a0b0c0d0e0f00011'))
    await expect.poll(() => edges().length).toBe(before + 1)
    const made = edges().at(-1)!
    expect(made).toMatchObject({
      fromNode: 'a0b0c0d0e0f00022',
      toNode: 'a0b0c0d0e0f00011',
      styleAttributes: { fromAnchor: '0.5,0.5', toAnchor: '0.5,0.5' },
    })
    // Sides too, so Obsidian draws it.
    expect(typeof made['fromSide']).toBe('string')

    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.locator('.canvas-tools__tool[aria-label="Arrow"]').click()
    await drag(await centre('a0b0c0d0e0f00022'), { x: pane.x + 60, y: pane.y + 60 })
    await expect.poll(() => edges().length).toBe(before + 2)
    expect(read(PLAN)).toContain('"styleAttributes":{"shape":"point"}')

    // Selected once drawn: its middle, dragged sideways, bends it.
    const bendHandle = page.locator('.canvas-edge__handle--bend')
    await expect.poll(() => bendHandle.count()).toBe(1)
    const h = (await bendHandle.boundingBox())!
    await drag({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2 + 50, y: h.y + h.height / 2 + 50 })
    await expect.poll(() => typeof (edges().at(-1)!['styleAttributes'] as Record<string, string>)['bend']).toBe('string')

    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Backspace')
    await expect.poll(() => edges().length).toBe(before + 1)
    expect(read(PLAN)).not.toContain('"shape":"point"')
  })
  it('the tool bar puts down a shape where the plane is clicked, then is Select again', async () => {
    await openPlan()
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('r')
    expect(await page.locator('.canvas-tools__tool[aria-label="Square"]').getAttribute('aria-pressed')).toBe('true')
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.click(pane.x + 120, pane.y + pane.height - 160)
    await expect.poll(() => read(PLAN)).toContain('"styleAttributes":{"shape":"rectangle"}')
    expect(await page.locator('.canvas-tools__tool[aria-label="Select"]').getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => page.locator('.canvas-node--shape .canvas-shape').count()).toBeGreaterThan(0)
  })

  it('the tool bar’s Note finds a note by name and puts it on the canvas', async () => {
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Escape')
    await page.locator('.canvas-tools__tool[aria-label="Note"]').click()
    const before = read(PLAN).split('"file":"Garden/Basil.md"').length - 1
    await page.locator('[aria-label="Find a note"]').fill('Basil')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(PLAN).split('"file":"Garden/Basil.md"').length - 1).toBe(before + 1)
  })

  it('a board on the canvas is its Markdown: the wheel over it scrolls its text, not the canvas; Obsidian’s %% settings %% are not shown', async () => {
    await openPlan()
    await page.locator('.canvas-view').focus()
    await page.keyboard.press('Escape')
    await page.locator('.canvas-tools__tool[aria-label="Board"]').click()
    await page.locator('[aria-label="Find a board"]').fill('Launch')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(PLAN)).toContain('"file":"Recto/Boards/Launch/Launch.md"')
    const id = (JSON.parse(read(PLAN)) as { nodes: { id: string; file?: string }[] }).nodes.find((n) => n.file === 'Recto/Boards/Launch/Launch.md')!.id
    // A board shows as its preview: lanes and their cards; a card's circle marks it done on the board.
    await nodeOf(id).click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Zoom to selection' }).click()
    await expect.poll(() => nodeOf(id).locator('.canvas-board__lane').count()).toBe(3)
    await expect.poll(() => nodeOf(id).locator('.canvas-board').textContent()).toContain('Write the announcement')
    await nodeOf(id).locator('[aria-label="Mark “Write the announcement” done"]').click()
    await expect
      .poll(() => {
        const board = read('Recto/Boards/Launch/Launch.md')
        return board.slice(board.indexOf('## Done')).includes('[[Write the announcement]]')
      })
      .toBe(true)
    // A lane's + adds a task there, as the board adds one.
    await nodeOf(id).locator('[aria-label="Add a task to To do"]').click()
    await nodeOf(id).locator('[aria-label="New task in To do"]').fill('Plant garlic')
    await page.keyboard.press('Enter')
    await expect.poll(() => read('Recto/Boards/Launch/Launch.md')).toContain('[[Plant garlic]]')
    await expect.poll(() => nodeOf(id).locator('.canvas-board__title', { hasText: 'Plant garlic' }).count()).toBe(1)
    // A name a note has in another folder: said where; a new card here, or that note put here if asked.
    await nodeOf(id).locator('[aria-label="Add a task to To do"]').click()
    fs.writeFileSync(path.join(vault, 'Garden/Garlic notes.md'), 'Cloves in October.\n')
    await nodeOf(id).locator('[aria-label="New task in To do"]').fill('Garlic notes')
    await page.keyboard.press('Enter')
    await expect.poll(() => nodeOf(id).locator('.canvas-board__said').textContent()).toContain('is already a note, in Garden')
    expect(await nodeOf(id).locator('.canvas-board__choices button').allTextContents()).toEqual(['Create a new “Garlic notes” here', 'Use the one in Garden'])
    await nodeOf(id).getByRole('button', { name: 'Use the one in Garden' }).click()
    await expect.poll(() => read('Recto/Boards/Launch/Launch.md')).toContain('[[Garlic notes]]')
    // Its name bar switches it to its Markdown, and back.
    await nodeOf(id).locator('[aria-label="Show Markdown"]').click()
    await expect.poll(() => nodeOf(id).locator('.canvas-board').count()).toBe(0)
    await page.locator('.canvas-view .board__tool', { hasText: 'Zoom to fit' }).first().click()
    const body = nodeOf(id).locator('.canvas-node__body')
    // Zoomed out, it is still its text - smaller, never a blank box or a stand-in.
    await expect.poll(() => body.textContent()).toContain('Write the announcement')
    await nodeOf(id).click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Zoom to selection' }).click()
    await expect.poll(() => body.textContent()).toContain('Write the announcement')
    expect(await body.textContent()).not.toContain('kanban:settings')
    // Short enough that its text runs past the bottom.
    await page.evaluate((nid) => {
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nid}"] .canvas-node__body`)!
      el.style.maxHeight = '80px'
    }, id)
    const viewport = (): Promise<string | null> => page.locator('.react-flow__viewport').getAttribute('style')
    // The zoom lands a frame after the click: read the view once it has.
    await page.waitForTimeout(300)
    const before = await viewport()
    const box = (await body.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    expect(await viewport()).toBe(before)
    // At the end of its text it still holds the wheel: only it scrolls, the canvas stays.
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(200)
    expect(await viewport()).toBe(before)
    // Over something that does not scroll, the canvas moves.
    await body.evaluate((el) => (el.style.maxHeight = 'none'))
    await page.mouse.wheel(0, 120)
    await expect.poll(viewport).not.toBe(before)
    await nodeOf(id).locator('[aria-label="Show as a board"]').click()
    await expect.poll(() => nodeOf(id).locator('.canvas-board').count()).toBe(1)
  })

  it('the style bar over a selected node sets its fill, and over an arrow its line and heads', async () => {
    await openPlan()
    await page.locator('.board__tool', { hasText: 'Zoom to fit' }).click()
    await nodeOf('1234abcd5678ef90').click()
    await page.locator('.canvas-style [aria-label="Fill"]').click()
    await page.locator('.canvas-style__option', { hasText: 'Solid' }).click()
    await expect.poll(() => read(PLAN)).toContain('"styleAttributes":{"shape":"pill","fill":"solid"}')
    await expect.poll(() => nodeOf('1234abcd5678ef90').locator('.canvas-node').getAttribute('data-fill')).toBe('solid')

    await page.locator('.react-flow__edge[data-id="b0b0b0b0b0b00033"]').dispatchEvent('click')
    await page.locator('.canvas-style [aria-label="Line"]').click()
    await page.locator('.canvas-style__option', { hasText: 'Dotted' }).click()
    await page.locator('.canvas-style [aria-label="Arrowhead at the start"]').click()
    await expect.poll(() => read(PLAN)).toMatch(/"id":"b0b0b0b0b0b00033".*"fromEnd":"arrow".*"path":"dotted"|"id":"b0b0b0b0b0b00033".*"path":"dotted".*"fromEnd":"arrow"/)
  })

  it('a card grows with what is typed into it, the height written once with the text', async () => {
    await openPlan()
    await page.locator('.board__tool', { hasText: 'Zoom to fit' }).click()
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.mouse.dblclick(pane.x + 80, pane.y + 80)
    await page.waitForFunction(() => document.activeElement?.closest('.canvas-node .cm-editor') !== null)
    for (let i = 0; i < 12; i++) await page.keyboard.type(`Line ${i}\n`)
    await page.keyboard.press('Escape')
    await expect.poll(() => read(PLAN)).toContain('Line 11')
    const made = (JSON.parse(read(PLAN)) as { nodes: { text?: string; height: number }[] }).nodes.find((n) => n.text?.includes('Line 11'))!
    expect(made.height).toBeGreaterThan(120)
  })

  it('a picture gets a caption, kept in the canvas file', async () => {
    const id = (JSON.parse(read(PLAN)) as { nodes: { id: string; file?: string }[] }).nodes.find((n) => n.file === 'attachments/sketch.png')!.id
    await nodeOf(id).click()
    await nodeOf(id).locator('.canvas-caption').dblclick()
    await page.locator('[aria-label="Caption"]').fill('First sketch')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(PLAN)).toContain('"caption":"First sketch"')
  })

  it('a note on the canvas opens beside it, the canvas staying in its own pane', async () => {
    const before = await page.locator('.tabs').count()
    await page.locator('.board__tool', { hasText: 'Zoom to fit' }).click()
    await page.waitForTimeout(200)
    await nodeOf('a0b0c0d0e0f00044').hover()
    await nodeOf('a0b0c0d0e0f00044').locator('[aria-label="Open beside the canvas"]').click()
    await expect.poll(() => page.locator('.tabs').count()).toBe(before + 1)
    await expect.poll(() => page.getByRole('tab', { name: 'Basil' }).count()).toBe(1)
    expect(await page.locator('.canvas-view').count()).toBe(1)
    // Closed again, so the tests after this have the one canvas.
    await page.getByRole('button', { name: 'Close Basil' }).click()
    await expect.poll(() => page.locator('.tabs').count()).toBe(before)
  })

  it('a task opened from the canvas shows its card on the right of the canvas, as on its board, without leaving the canvas', async () => {
    await openPlan()
    await page.locator('.canvas-view .board__tool', { hasText: 'Zoom to fit' }).first().click()
    await page.locator('.canvas-node--card').first().dblclick()
    await page.waitForSelector('.canvas-card-panel .card-panel')
    expect(await page.locator('.canvas-view').count()).toBeGreaterThan(0)
    expect(await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Canvas' }).getAttribute('aria-selected')).toBe('true')
    await page.locator('.canvas-card-panel [aria-label="Close card"]').click()
    await expect.poll(() => page.locator('.canvas-card-panel').count()).toBe(0)
  })

  it('a picture is put down in its own proportions, and a node of another shape takes the picture’s when it loads', async () => {
    await openPlan()
    await page.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 200
      c.height = 100
      const g = c.getContext('2d')!
      g.fillStyle = '#3a7'
      g.fillRect(0, 0, 200, 100)
      const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'))
      const plane = document.querySelector('.canvas-view__plane')!
      const data = new DataTransfer()
      data.items.add(new File([blob], 'wide.png', { type: 'image/png' }))
      const rect = plane.getBoundingClientRect()
      const at = { clientX: rect.left + 300, clientY: rect.top + 300, bubbles: true, cancelable: true, dataTransfer: data }
      plane.dispatchEvent(new DragEvent('dragover', at))
      plane.dispatchEvent(new DragEvent('drop', at))
    })
    const node = (): { width: number; height: number } | undefined =>
      (JSON.parse(read(PLAN)) as { nodes: { file?: string; width: number; height: number; id: string }[] }).nodes.find((n) => n.file === 'attachments/wide.png')
    await expect.poll(() => node(), { timeout: 5000 }).toBeDefined()
    await expect.poll(() => node()).toMatchObject({ width: 400, height: 200 })
    // Changed outside Recto to the wrong shape: put right when the picture is drawn.
    const text = read(PLAN).replace(/("file":"attachments\/wide\.png"[^}]*"height":)200|("height":)200(,[^}]*"file":"attachments\/wide\.png")/, (m) => m.replace('200', '330'))
    fs.writeFileSync(path.join(vault, PLAN), text)
    await expect.poll(() => node()?.height).toBe(330)
    // Opened again, as when the canvas is opened later: the picture is read and the node fitted to it.
    await page.locator('.canvas-list .boards__name', { hasText: 'Second plan' }).click()
    await page.waitForFunction(() => document.querySelector('.canvas-view__name')?.textContent === 'Second plan')
    await openPlan()
    await expect.poll(() => node()?.height, { timeout: 5000 }).toBe(200)
  })

  it('a note grows while it is edited on the canvas and goes back to its size after', async () => {
    const before = (JSON.parse(read(PLAN)) as { nodes: { id: string; height: number }[] }).nodes.find((n) => n.id === 'a0b0c0d0e0f00044')!.height
    await nodeOf('a0b0c0d0e0f00044').locator('.canvas-node__body').dblclick()
    await page.waitForFunction(() => document.activeElement?.closest('.canvas-node .cm-editor') !== null)
    for (let i = 0; i < 14; i++) await page.keyboard.type(`More ${i}\n`)
    await expect.poll(async () => (await nodeOf('a0b0c0d0e0f00044').boundingBox())!.height).toBeGreaterThan(0)
    const grown = await nodeOf('a0b0c0d0e0f00044').evaluate((el) => (el as HTMLElement).offsetHeight)
    expect(grown).toBeGreaterThan(before)
    await page.keyboard.press('Escape')
    await expect.poll(() => nodeOf('a0b0c0d0e0f00044').evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(before)
    expect((JSON.parse(read(PLAN)) as { nodes: { id: string; height: number }[] }).nodes.find((n) => n.id === 'a0b0c0d0e0f00044')!.height).toBe(before)
  })

  it('a vault file is served in parts, as a video player asks for them (a movie whose index is at its end plays)', async () => {
    // Asked from the main process: a page's fetch with a Range header is held back by cross-origin rules
    // that a <video> loading the same URL is not.
    const part = await app.evaluate(async ({ net }) => {
      const res = await net.fetch('recto-file://vault/attachments/wide.png', { headers: { Range: 'bytes=1-3' } })
      return { status: res.status, range: res.headers.get('Content-Range'), bytes: [...new Uint8Array(await res.arrayBuffer())] }
    })
    const file = fs.readFileSync(path.join(vault, 'attachments/wide.png'))
    expect(part.status).toBe(206)
    expect(part.range).toBe(`bytes 1-3/${file.length}`)
    expect(part.bytes).toEqual([...file.subarray(1, 4)])
  })

  it('a shape’s text is under it, outside it - but a square’s is inside', async () => {
    await openPlan()
    await page.locator('.canvas-view .board__tool', { hasText: 'Zoom to fit' }).first().click()
    // Only the square is made in Recto; other shapes come from Obsidian's Advanced Canvas, drawn the same way.
    const doc = JSON.parse(read(PLAN)) as { nodes: Record<string, unknown>[] }
    doc.nodes.push({ id: 'f0f0f0f0f0f00001', type: 'text', text: 'Idea', x: 2000, y: 0, width: 120, height: 120, styleAttributes: { shape: 'circle' } })
    fs.writeFileSync(path.join(vault, PLAN), JSON.stringify(doc, null, '\t'))
    // Read from the file once Recto sees it changed; drawn once it is in view.
    await expect
      .poll(
        async () => {
          await page.locator('.canvas-view .board__tool', { hasText: 'Zoom to fit' }).first().click()
          return page.locator('.canvas-node--shape.is-circle', { hasText: 'Idea' }).count()
        },
        { timeout: 8000 },
      )
      .toBeGreaterThan(0)
    const shape = page.locator('.canvas-node--shape.is-circle', { hasText: 'Idea' }).first()
    const box = (await shape.boundingBox())!
    const text = (await shape.locator('.canvas-node__body').boundingBox())!
    expect(text.y).toBeGreaterThanOrEqual(box.y + box.height)
  })

  it('a video on the canvas is its still frame; ▶ plays it in the mini-player window, on top, not in the canvas', async () => {
    await openPlan()
    // A real video, made here: half a second of a canvas, recorded.
    await page.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 90
      const g = c.getContext('2d')!
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' })
      const parts: Blob[] = []
      rec.ondataavailable = (e) => parts.push(e.data)
      const stopped = new Promise((resolve) => (rec.onstop = resolve))
      rec.start()
      for (let i = 0; i < 8; i++) {
        g.fillStyle = `hsl(${i * 40} 70% 50%)`
        g.fillRect(0, 0, 160, 90)
        await new Promise((r) => setTimeout(r, 60))
      }
      rec.stop()
      await stopped
      const plane = document.querySelector('.canvas-view__plane')!
      const data = new DataTransfer()
      data.items.add(new File(parts, 'clip.webm', { type: 'video/webm' }))
      const rect = plane.getBoundingClientRect()
      const at = { clientX: rect.left + 200, clientY: rect.top + 200, bubbles: true, cancelable: true, dataTransfer: data }
      plane.dispatchEvent(new DragEvent('dragover', at))
      plane.dispatchEvent(new DragEvent('drop', at))
    })
    await expect.poll(() => read(PLAN), { timeout: 5000 }).toContain('"file":"attachments/clip.webm"')
    const video = page.locator('.canvas-node--file.is-video').first()
    await expect.poll(() => video.locator('[aria-label="Play the video"]').count()).toBe(1)
    expect(await video.locator('video[controls]').count()).toBe(0)
    await video.locator('[aria-label="Play the video"]').click()
    await expect.poll(() => app.windows().length).toBe(2)
    const shown = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), top: w.isAlwaysOnTop(), title: w.getTitle() })),
    )
    const player = shown.find((w) => w.url.startsWith('data:text/html'))!
    expect(decodeURIComponent(player.url)).toContain('recto-file://vault/attachments/clip.webm')
    expect(player.top).toBe(true)
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('data:')) w.close()
    })
  })

  it('a text file on the canvas shows its lines and is edited in place, saved to the file; another format is a card that opens it', async () => {
    await openPlan()
    await page.evaluate(() => {
      const plane = document.querySelector('.canvas-view__plane')!
      const data = new DataTransfer()
      data.items.add(new File(['Seeds to buy\n- basil\n'], 'shopping.txt', { type: 'text/plain' }))
      data.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'bundle.zip', { type: 'application/zip' }))
      const rect = plane.getBoundingClientRect()
      const at = { clientX: rect.left + 240, clientY: rect.top + 160, bubbles: true, cancelable: true, dataTransfer: data }
      plane.dispatchEvent(new DragEvent('dragover', at))
      plane.dispatchEvent(new DragEvent('drop', at))
    })
    await expect.poll(() => read(PLAN), { timeout: 5000 }).toContain('"file":"attachments/shopping.txt"')
    const node = page.locator('.canvas-node--textfile', { hasText: 'shopping.txt' }).first()
    await expect.poll(() => node.locator('.canvas-code__preview').textContent()).toContain('Seeds to buy')
    await node.locator('.canvas-node__body').dblclick()
    await node.locator('.code-view .cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('- dill')
    await expect.poll(() => fs.readFileSync(path.join(vault, 'attachments/shopping.txt'), 'utf8'), { timeout: 5000 }).toContain('- dill')
    await page.keyboard.press('Escape')
    await expect.poll(() => node.locator('.canvas-code__preview').textContent()).toContain('- dill')

    const other = page.locator('.canvas-node--file', { hasText: 'bundle.zip' }).first()
    await expect.poll(() => other.getByRole('button', { name: 'Open' }).count()).toBe(1)
    expect(await other.getByRole('button', { name: 'Reveal in Finder' }).count()).toBe(1)
  })

  it('a PDF on the canvas is a preview; double-clicked it opens beside the canvas, where text is highlighted - and the canvas shows it', async () => {
    await openPlan()
    fs.mkdirSync(path.join(vault, 'attachments'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'attachments/treatise.pdf'), makePdf(['Of knowledge and probability', 'Of the passions']))
    // Put down from the tree, as a file dragged in is.
    await page.evaluate(() => {
      const plane = document.querySelector('.canvas-view__plane')!
      const data = new DataTransfer()
      data.setData('application/x-recto-tree-path', 'attachments/treatise.pdf')
      const rect = plane.getBoundingClientRect()
      const at = { clientX: rect.left + 260, clientY: rect.top + 140, bubbles: true, cancelable: true, dataTransfer: data }
      plane.dispatchEvent(new DragEvent('dragover', at))
      plane.dispatchEvent(new DragEvent('drop', at))
    })
    await expect.poll(() => read(PLAN), { timeout: 5000 }).toContain('"file":"attachments/treatise.pdf"')
    const node = page.locator('.canvas-node--pdf').first()
    // Zoomed far out, a stand-in: its first page only.
    const zoomOf = async (): Promise<number> => Number(/scale\(([\d.]+)\)/.exec((await page.locator('.react-flow__viewport').first().getAttribute('style')) ?? '')?.[1])
    if ((await zoomOf()) < 0.45) await expect.poll(() => node.locator('.pdf-view__page').count(), { timeout: 8000 }).toBe(1)
    // Near enough to read: every page.
    await node.click({ button: 'right' })
    await page.locator('.menu__item', { hasText: 'Zoom to selection' }).click()
    await expect.poll(() => node.locator('.pdf-view__page').count(), { timeout: 8000 }).toBe(2)
    // A preview: nothing to select in it.
    expect(await node.locator('.textLayer').count()).toBe(0)
    // ...but its pages are drawn: the first has ink on it.
    await expect
      .poll(
        () =>
          node.locator('.pdf-view__canvas').first().evaluate((c) => {
            const canvas = c as HTMLCanvasElement
            if (canvas.width === 0) return 0
            const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
            let dark = 0
            for (let i = 0; i < data.length; i += 4) if (data[i]! < 128 && data[i + 3]! > 0) dark++
            return dark
          }),
        { timeout: 8000 },
      )
      .toBeGreaterThan(0)

    await node.locator('.pdf-view__scroll').dblclick()
    // A panel docked on the right, as the AI panel is - not a tab.
    const reader = page.locator('.pdf-panel .pdf-view.is-reader')
    await expect.poll(() => reader.locator('.textLayer').first().textContent(), { timeout: 8000 }).toContain('knowledge')
    expect(await page.locator('.canvas-view').count()).toBeGreaterThan(0)
    // Select a word in the reader, as the mouse would, and highlight it.
    await reader.evaluate((el) => {
      const span = [...el.querySelectorAll('.textLayer span')].find((s) => s.textContent?.includes('knowledge'))!
      const text = span.firstChild!
      const at = text.textContent!.indexOf('knowledge')
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 'knowledge'.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      el.querySelector('.pdf-view__scroll')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    const add = (await reader.locator('.pdf-view__add').boundingBox())!
    await page.mouse.click(add.x + add.width / 2, add.y + add.height / 2)
    await expect.poll(() => reader.locator('.pdf-view__mark').count(), { timeout: 3000 }).toBeGreaterThan(0)
    const kept = (await invoke('state:read', 'pdf-highlights')) as Record<string, { text: string; page: number }[]>
    expect(kept['attachments/treatise.pdf']?.[0]).toMatchObject({ text: 'knowledge', page: 1 })
    // The canvas's preview shows the same highlight.
    await expect.poll(() => node.locator('.pdf-view__mark').count(), { timeout: 8000 }).toBeGreaterThan(0)
    // Clicked in the reader, it goes - from both.
    const mark = (await reader.locator('.pdf-view__mark').first().boundingBox())!
    await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2)
    await expect.poll(() => node.locator('.pdf-view__mark').count(), { timeout: 3000 }).toBe(0)
    // Its left edge, dragged left, makes it wider.
    const before = (await page.locator('.pdf-panel').boundingBox())!
    await page.mouse.move(before.x + 1, before.y + before.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.x - 120, before.y + before.height / 2, { steps: 6 })
    await page.mouse.up()
    expect((await page.locator('.pdf-panel').boundingBox())!.width).toBeGreaterThan(before.width + 60)
    await page.locator('.pdf-panel [aria-label="Close the PDF"]').click()
    await expect.poll(() => page.locator('.pdf-panel').count()).toBe(0)
  })

  it('a canvas outside Recto/Canvas is offered a move there, and moved only when asked', async () => {
    fs.writeFileSync(path.join(vault, 'Garden/Old plan.canvas'), '{\n\t"nodes":[],\n\t"edges":[]\n}')
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Canvas' }).click()
    const offer = page.locator('.canvas-list__strays')
    await expect.poll(() => offer.count(), { timeout: 8000 }).toBe(1)
    expect(fs.existsSync(path.join(vault, 'Garden/Old plan.canvas'))).toBe(true)
    await offer.getByRole('button').click()
    await expect.poll(() => fs.existsSync(path.join(vault, 'Recto/Canvas/Old plan.canvas'))).toBe(true)
    expect(fs.existsSync(path.join(vault, 'Garden/Old plan.canvas'))).toBe(false)
    await expect.poll(() => offer.count()).toBe(0)
  })

  it('a web address pasted on the canvas is a link card; a YouTube one a video preview with ▶', async () => {
    await openPlan()
    // The system clipboard is the person's: what was on it goes back when the test is done.
    const theirs = await app.evaluate(({ clipboard }) => clipboard.readText())
    await app.evaluate(({ clipboard }) => clipboard.writeText('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('Meta+v')
    await expect.poll(() => read(PLAN)).toContain('"type":"link","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"')
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), theirs)
    const made = (JSON.parse(read(PLAN)) as { nodes: { url?: string; width: number; height: number }[] }).nodes.find((n) => n.url?.includes('dQw4w9WgXcQ'))!
    expect(made).toMatchObject({ width: 480, height: 270 })
    await expect.poll(() => page.locator('.canvas-node--video [aria-label="Play the video"]').count()).toBeGreaterThan(0)
  })

  it('the pen draws a drawing, kept as an SVG Obsidian can show; each stroke is a drawing of its own; a drawing double-clicked opens to edit its strokes and to draw more in it; the eraser cuts, or takes whole strokes; pen panel; draw and hold', async () => {
    await openPlan()
    await page.locator('.canvas-view .board__tool', { hasText: 'Zoom to fit' }).first().click()
    const pane = (await page.locator('.react-flow__pane').first().boundingBox())!
    const stroke = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 12 })
      await page.mouse.up()
    }
    const svgPath = 'Recto/Canvas/Garden plan drawings/Drawing.svg'
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('p')
    await stroke({ x: pane.x + 40, y: pane.y + 40 }, { x: pane.x + 140, y: pane.y + 70 })
    await expect.poll(() => fs.existsSync(path.join(vault, svgPath)), { timeout: 5000 }).toBe(true)
    await expect.poll(() => read(PLAN)).toContain(`"file":"${svgPath}"`)
    const svg = read(svgPath)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('<metadata id="recto-drawing">')
    const strokes = (file: string): number => (JSON.parse(read(file).match(/<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/)![1]!) as unknown[]).length
    // A second stroke right over the first, at once: a drawing of its own - the first is left as it was.
    const first = read(svgPath)
    await stroke({ x: pane.x + 60, y: pane.y + 30 }, { x: pane.x + 70, y: pane.y + 90 })
    const second = 'Recto/Canvas/Garden plan drawings/Drawing 2.svg'
    await expect.poll(() => fs.existsSync(path.join(vault, second)), { timeout: 5000 }).toBe(true)
    expect(read(svgPath)).toBe(first)
    await expect.poll(() => read(second).includes('recto-drawing'), { timeout: 5000 }).toBe(true)
    expect(strokes(second)).toBe(1)
    await page.keyboard.press('Escape')
    // Double-clicked, a drawing opens to edit; "Draw here" and it takes the strokes drawn on it.
    await page.locator('.react-flow__node', { has: page.locator(`.canvas-node--drawing`) }).first().locator('svg').dblclick()
    await page.locator('.drawing-editor__bar').getByRole('button', { name: 'Draw here' }).click()
    await stroke({ x: pane.x + 45, y: pane.y + 50 }, { x: pane.x + 130, y: pane.y + 55 })
    await expect.poll(() => (read(svgPath).includes('recto-drawing') ? strokes(svgPath) : 0), { timeout: 5000 }).toBe(2)
    // The eraser, dragged across both its strokes, takes them away: the drawing leaves the canvas (its file stays); the other is untouched.
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('e')
    await page.locator('.canvas-pen').getByRole('button', { name: 'Whole strokes' }).click()
    await stroke({ x: pane.x + 90, y: pane.y + 40 }, { x: pane.x + 90, y: pane.y + 65 })
    await expect.poll(() => read(PLAN).includes(`"file":"${svgPath}"`), { timeout: 5000 }).toBe(false)
    expect(read(PLAN)).toContain(`"file":"${second}"`)
    // Cutting (the eraser's own way): a line erased across its middle is two lines.
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('p')
    await stroke({ x: pane.x + 40, y: pane.y + 260 }, { x: pane.x + 340, y: pane.y + 260 })
    const cutPath = 'Recto/Canvas/Garden plan drawings/Drawing 3.svg'
    await expect.poll(() => (fs.existsSync(path.join(vault, cutPath)) ? read(cutPath) : ''), { timeout: 5000 }).toContain('recto-drawing')
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('e')
    await page.locator('.canvas-pen').getByRole('button', { name: 'Cut' }).click()
    await stroke({ x: pane.x + 190, y: pane.y + 230 }, { x: pane.x + 190, y: pane.y + 290 })
    await expect.poll(() => strokes(cutPath), { timeout: 5000 }).toBe(2)
    // Double-clicked, a drawing opens in the stroke editor: a stroke clicked is selected, recoloured, deleted, ⌘Z brings it back, dragged it moves.
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('Escape')
    await page.mouse.dblclick(pane.x + 80, pane.y + 260)
    await page.waitForSelector('.drawing-editor')
    await page.mouse.click(pane.x + 80, pane.y + 260)
    await page.locator('.drawing-editor__bar').getByRole('button', { name: '#1971c2' }).click()
    await expect.poll(() => read(cutPath), { timeout: 5000 }).toContain('fill="#1971c2"')
    const colours = (): (string | null)[] => (JSON.parse(read(cutPath).match(/<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/)![1]!) as { color: string | null }[]).map((x) => x.color)
    expect(colours().sort()).toEqual(['#1971c2', null].sort())
    await page.keyboard.press('Backspace')
    await expect.poll(() => strokes(cutPath), { timeout: 5000 }).toBe(1)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => strokes(cutPath), { timeout: 5000 }).toBe(2)
    const xs = (): number => Math.min(...(JSON.parse(read(cutPath).match(/<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/)![1]!) as { points: number[][] }[]).flatMap((x) => x.points.map((q) => q[0]!)))
    const before = read(cutPath)
    await page.mouse.click(pane.x + 80, pane.y + 260)
    await page.mouse.move(pane.x + 80, pane.y + 260)
    await page.mouse.down()
    await page.mouse.move(pane.x + 80, pane.y + 340, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => read(cutPath) !== before, { timeout: 5000 }).toBe(true)
    expect(xs()).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.drawing-editor', { state: 'detached' })
    await page.keyboard.press('Escape')
    // The pen panel, over the tool bar while Draw is on: a highlighter in green, under any ink, see-through.
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('p')
    await page.locator('.canvas-pen').getByRole('button', { name: 'Highlighter' }).click()
    await page.locator('.canvas-pen').getByRole('button', { name: '#82c91e' }).click()
    await page.locator('.canvas-pen').getByRole('button', { name: 'Large', exact: true }).click()
    await stroke({ x: pane.x + 200, y: pane.y + 150 }, { x: pane.x + 320, y: pane.y + 150 })
    const third = 'Recto/Canvas/Garden plan drawings/Drawing 4.svg'
    await expect.poll(() => (fs.existsSync(path.join(vault, third)) ? read(third) : ''), { timeout: 5000 }).toContain('fill="#82c91e" fill-opacity="0.35"')
    expect(fromSvgStrokes(read(third))).toEqual([{ kind: 'highlighter', color: '#82c91e', size: 24 }])
    // Kept for the next time: Draw again, and the highlighter is still chosen.
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('p')
    expect(await page.locator('.canvas-pen').getByRole('button', { name: 'Highlighter' }).getAttribute('aria-pressed')).toBe('true')
    await page.locator('.canvas-pen').getByRole('button', { name: 'Pen', exact: true }).click()
    // Draw and hold: a box drawn and held still for a moment is saved as a rectangle; let go at once, it stays as drawn.
    const box = async (x: number, y: number, holdMs: number): Promise<void> => {
      await page.mouse.move(x, y)
      await page.mouse.down()
      for (const [dx, dy] of [[160, 4], [164, 100], [2, 98], [0, 3]] as const) await page.mouse.move(x + dx, y + dy, { steps: 14 })
      await page.waitForTimeout(holdMs)
      await page.mouse.up()
    }
    const shapes = (file: string): unknown[] =>
      (JSON.parse(read(file).match(/<metadata id="recto-drawing">([\s\S]*?)<\/metadata>/)![1]!) as { shape?: string }[]).map((s) => s.shape)
    await box(pane.x + 420, pane.y + 60, 700)
    const fourth = 'Recto/Canvas/Garden plan drawings/Drawing 5.svg'
    await expect.poll(() => (fs.existsSync(path.join(vault, fourth)) ? read(fourth) : ''), { timeout: 5000 }).toContain('recto-drawing')
    expect(shapes(fourth)).toEqual(['rectangle'])
    await box(pane.x + 420, pane.y + 220, 0)
    const fifth = 'Recto/Canvas/Garden plan drawings/Drawing 6.svg'
    await expect.poll(() => (fs.existsSync(path.join(vault, fifth)) ? read(fifth) : ''), { timeout: 5000 }).toContain('recto-drawing')
    expect(shapes(fifth)).toEqual([undefined])
    await page.keyboard.press('Escape')
  })

  it('Text puts words on the canvas with no card round them', async () => {
    await page.locator('.canvas-view').first().focus()
    await page.keyboard.press('t')
    const pane = (await page.locator('.react-flow__pane').first().boundingBox())!
    await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 120)
    await page.waitForFunction(() => document.activeElement?.closest('.canvas-node .cm-editor') !== null)
    await page.keyboard.type('Just words')
    await page.keyboard.press('Escape')
    await expect.poll(() => read(PLAN)).toContain('"text":"Just words"')
    expect(read(PLAN)).toMatch(/"text":"Just words"[^}]*"styleAttributes":\{"border":"invisible","fill":"none"\}/)
  })

  it('“Make it a note” with a name another note has: “Use that note” puts that note on the canvas and never moves it; “Create a new” makes one beside the canvas', async () => {
    const basilNodes = (): number => read(PLAN).split('"file":"Garden/Basil.md"').length - 1
    const textNode = async (words: string, dx: number): Promise<void> => {
      const pane = (await page.locator('.react-flow__pane').boundingBox())!
      await page.mouse.dblclick(pane.x + 160 + dx, pane.y + pane.height - 120)
      await page.waitForFunction(() => document.activeElement?.closest('.cm-editor') !== null)
      await page.keyboard.type(words)
      await page.keyboard.press('Escape')
      await expect.poll(() => read(PLAN)).toContain(`"text":"${words}"`)
      await page.locator('.canvas-node', { hasText: words }).click({ button: 'right' })
      await page.locator('.menu__item', { hasText: 'Make it a note' }).click()
      await page.locator('[aria-label="Note name"]').fill('Basil')
      await page.keyboard.press('Enter')
      await expect.poll(() => page.locator('[aria-label="A note of this name exists"]').textContent()).toContain('“Basil” is already a note, in Garden.')
    }
    await openPlan()
    const garden = read('Garden/Basil.md')
    const before = basilNodes()

    await textNode('Sow basil early', 0)
    await page.locator('.canvas-bar__use', { hasText: 'Use that note' }).click()
    await expect.poll(basilNodes).toBe(before + 1)
    expect(read(PLAN)).not.toContain('Sow basil early')
    expect(read('Garden/Basil.md')).toBe(garden)
    expect(fs.existsSync(path.join(vault, 'Basil.md'))).toBe(false)

    await textNode('Pinch the flowers', 300)
    await page.locator('.canvas-bar .btn--primary', { hasText: 'Create a new “Basil” here' }).click()
    await expect.poll(() => (fs.existsSync(path.join(vault, 'Basil.md')) ? read('Basil.md') : null)).toBe('Pinch the flowers\n')
    await expect.poll(() => read(PLAN)).toContain('"file":"Basil.md"')
    expect(read('Garden/Basil.md')).toBe(garden)
    expect(basilNodes()).toBe(before + 1)
  })

  it('a group turned into a board: its cards in order, the board put beside it; a board shown as a canvas: a group per lane', async () => {
    const shop = 'Recto/Canvas/Shop.canvas'
    fs.writeFileSync(
      path.join(vault, shop),
      JSON.stringify({
        nodes: [
          { id: 'f0f0f0f0f0f0f001', type: 'group', label: 'Shopping', x: -40, y: -60, width: 400, height: 420 },
          { id: 'f0f0f0f0f0f0f002', type: 'text', text: 'Buy compost', x: 0, y: 0, width: 300, height: 80 },
          { id: 'f0f0f0f0f0f0f003', type: 'file', file: 'Garden/Basil.md', x: 0, y: 120, width: 300, height: 200 },
        ],
        edges: [],
      }),
    )
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Canvas' }).click()
    await page.locator('.canvas-list .boards__name', { hasText: 'Shop' }).first().click()
    await page.waitForSelector('.react-flow__node[data-id="f0f0f0f0f0f0f001"]')
    await page.waitForTimeout(400)
    await page.locator('.canvas-view').first().locator('.react-flow__node[data-id="f0f0f0f0f0f0f001"] .canvas-group__label, .react-flow__node[data-id="f0f0f0f0f0f0f001"]').first().click({ button: 'right', position: { x: 20, y: 10 } })
    await page.locator('.menu__item', { hasText: 'Turn into a board' }).click()
    const board = 'Recto/Boards/Shopping/Shopping.md'
    // A link as Obsidian writes it from the board: with its path, as another Basil is in the vault.
    await expect.poll(() => (fs.existsSync(path.join(vault, board)) ? read(board) : ''), { timeout: 8000 }).toContain('[[Garden/Basil]]')
    const lines = read(board).split('\n').filter((l) => l.startsWith('- [ ]'))
    expect(lines.slice(0, 2)).toEqual(['- [ ] Buy compost', '- [ ] [[Garden/Basil]]'])
    await expect.poll(() => read(shop), { timeout: 5000 }).toContain(`"file":"${board}"`)

    // The board on the canvas, shown as a canvas of its own.
    const boardNode = (JSON.parse(read(shop)) as { nodes: { id: string; file?: string }[] }).nodes.find((n) => n.file === board)!.id
    // Once the app knows it is a board, it is drawn as one.
    await nodeOf(boardNode).locator('.canvas-board').waitFor({ timeout: 10_000 })
    await nodeOf(boardNode).click({ button: 'right', position: { x: 30, y: 12 } })
    await page.locator('.menu__item', { hasText: 'Show board as canvas' }).click()
    const shown = 'Recto/Canvas/Shopping board.canvas'
    await expect.poll(() => fs.existsSync(path.join(vault, shown)), { timeout: 8000 }).toBe(true)
    const doc = JSON.parse(read(shown)) as { nodes: { type: string; label?: string; text?: string; file?: string }[] }
    expect(doc.nodes.filter((n) => n.type === 'group').map((n) => n.label)).toEqual(expect.arrayContaining(['To do']))
    expect(doc.nodes.some((n) => n.file === 'Garden/Basil.md')).toBe(true)
    expect(doc.nodes.some((n) => n.text === 'Buy compost')).toBe(true)
  })
})
