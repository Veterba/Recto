import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE_SETTINGS } from '../../src/shared/templates'
import { periodNotePath } from '../../src/shared/periodic'
import { quitApp, removeDir } from './helpers/app'

/**
 * recto-mcp against a running Recto, the way an AI client uses it: the
 * launcher Recto wrote at start, spoken to over stdio as JSON-RPC, every tool
 * called on a copy of the fixture vault. Kitchen/ is excluded from AI and
 * never leaks - not as a hit, a backlink, a related note or a folder.
 * Proposals wait for Apply; Apply writes them. Runs with `npm run test:e2e`.
 */

const RUN = process.env['RECTO_E2E'] === '1'
const ROOT = path.resolve(__dirname, '../..')

type Content = { type: string; text: string }
type CallResult = { content: Content[]; isError?: boolean }

/** A minimal MCP client over the launcher's stdio. */
class Client {
  private buffer = ''
  private next = 1
  private waiting = new Map<number, (message: { result?: unknown; error?: unknown }) => void>()
  constructor(private proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let at: number
      while ((at = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, at)
        this.buffer = this.buffer.slice(at + 1)
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown }
        if (message.id !== undefined) this.waiting.get(message.id)?.(message)
      }
    })
  }
  request(method: string, params: unknown = {}): Promise<{ result?: unknown; error?: unknown }> {
    const id = this.next++
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  notify(method: string): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    return (await this.request('tools/call', { name, arguments: args })).result as CallResult
  }
  /** The call's structured data (its first block), failing loudly on an error. */
  async data<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.call(name, args)
    if (result.isError === true) throw new Error(`${name}: ${result.content[0]?.text}`)
    return JSON.parse(result.content[0]!.text) as T
  }
}

const allText = (r: CallResult): string => r.content.map((c) => c.text).join('\n')
type WithApi = { api: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }

const invoke = (page: Page, channel: string, id: string): Promise<unknown> =>
  page.evaluate(([c, i]) => (window as unknown as WithApi).api.invoke(c!, i), [channel, id])

describe.skipIf(!RUN)('recto-mcp, against a running Recto', () => {
  let app: ElectronApplication
  let page: Page
  let base = ''
  let vault = ''
  let profile = ''
  let proc: ChildProcessWithoutNullStreams
  let client: Client
  const read = (rel: string): string => fs.readFileSync(path.join(vault, rel), 'utf8')
  const settings = {
    ...DEFAULT_TEMPLATE_SETTINGS,
    folder: 'Template',
    periodic: { ...DEFAULT_TEMPLATE_SETTINGS.periodic, daily: { enabled: true, template: null, folder: null } },
  }
  const today = periodNotePath('daily', new Date(), settings.periodic)

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-e2e-mcp-'))
    vault = path.join(base, 'vault')
    profile = path.join(base, 'profile')
    fs.cpSync(path.join(ROOT, 'test/fixtures/snapshot-vault'), vault, { recursive: true })
    fs.writeFileSync(path.join(vault, '.recto', 'templates.json'), JSON.stringify(settings))
    fs.writeFileSync(
      path.join(vault, '.recto', 'ai-access.json'),
      JSON.stringify({ excluded: ['Kitchen'], writeMode: 'propose', formatting: { headingBlankBefore: 'one', headingBlankAfter: 'none' } }),
    )
    fs.mkdirSync(profile)
    fs.writeFileSync(path.join(profile, 'app-state.json'), JSON.stringify({ lastVaultPath: vault }))
    app = await _electron.launch({
      args: ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${profile}`],
      env: { ...process.env, RECTO_ALLOW_REAL_VAULT: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('[role=treeitem]', { timeout: 60_000 })
    // The index is ready once a search finds a note.
    await page.waitForFunction(
      async () => ((await (window as unknown as WithApi).api.invoke('index:search', 'basil', 5)) as unknown[]).length > 0,
      undefined,
      {
        timeout: 60_000,
      },
    )

    proc = spawn(path.join(profile, 'bin', 'recto-mcp'), ['--client', 'e2e'], { stdio: 'pipe' })
    client = new Client(proc)
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    })
    expect((init.result as { instructions?: string }).instructions).toMatch(/get_ai_guide/)
    client.notify('notifications/initialized')
  }, 120_000)

  afterAll(async () => {
    proc?.kill()
    await quitApp(app)
    removeDir(base)
  }, 30_000)

  it('lists every tool, read tools marked read-only and write tools not', async () => {
    const { tools } = (await client.request('tools/list')).result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }
    expect(tools).toHaveLength(19)
    expect(tools.find((t) => t.name === 'read_note')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'propose_edit')?.annotations?.readOnlyHint).toBe(false)
  })

  it('the guide and the profile', async () => {
    expect(await client.data('get_ai_guide')).toMatchObject({ path: null })
    const profile_ = await client.data<{
      notes: number
      folders: { folder: string }[]
      boards: { name: string }[]
      excluded_from_ai: string[]
      topics?: unknown
      periodic_notes: { daily: { on: boolean } }
    }>('get_vault_profile')
    expect(profile_.folders.map((f) => f.folder)).not.toContain('Kitchen/')
    expect(profile_.boards.map((b) => b.name)).toEqual(['Launch'])
    expect(profile_.excluded_from_ai).toEqual(['Kitchen'])
    expect(profile_.periodic_notes.daily.on).toBe(true)
    // Topics are off in the fixture: left out, not "off".
    expect(profile_.topics).toBeUndefined()
  })

  it('search, read, context, folders, recent, tags: Kitchen never shows', async () => {
    const search = await client.call('search_notes', { query: 'basil', mode: 'text' })
    expect(allText(search)).toContain('Garden/Basil.md')
    expect(allText(search)).not.toContain('Kitchen/')
    expect(allText(await client.call('search_notes', { query: 'starter', mode: 'text' }))).not.toContain('Kitchen/')

    const note = await client.data<{ path: string; backlinks: { path: string }[]; links_out: { target: string; path: string | null }[] }>(
      'read_note',
      { note: 'Basil' },
    )
    expect(note.path).toBe('Garden/Basil.md')
    expect(note.backlinks.map((b) => b.path)).toContain('Garden/Tomatoes.md')
    expect(note.backlinks.map((b) => b.path)).not.toContain('Kitchen/Sourdough.md')
    expect(note.links_out).toContainEqual({ target: 'Tomatoes', path: 'Garden/Tomatoes.md' })

    const sourdough = await client.call('read_note', { note: 'Kitchen/Sourdough.md' })
    expect(sourdough.isError).toBe(true)
    expect(allText(sourdough)).toMatch(/No note/)

    const context = await client.call('get_note_context', { note: 'Basil' })
    expect(allText(context)).toContain('Garden/Tomatoes.md')
    expect(allText(context)).not.toContain('Kitchen/')

    const top = await client.data<{ entries: { path: string }[] }>('list_folder', {})
    expect(top.entries.map((e) => e.path)).toEqual(expect.arrayContaining(['Garden', 'Recto', 'Handbook.md']))
    expect(top.entries.map((e) => e.path)).not.toContain('Kitchen')
    expect((await client.call('list_folder', { folder: 'Kitchen' })).isError).toBe(true)

    expect(allText(await client.call('recent_notes', { limit: 100 }))).not.toContain('Kitchen/')
    const tags = await client.data<{ tag: string }[]>('list_tags')
    expect(tags.map((t) => t.tag)).toContain('garden')
    expect(tags.map((t) => t.tag)).not.toContain('baking')
  }, 30_000)

  it('periodic notes, boards and tasks', async () => {
    // Recto makes today's note when it opens.
    expect(await client.data('get_periodic_note', { period: 'daily' })).toMatchObject({ enabled: true, path: today.path, exists: true })
    expect(await client.data('get_periodic_note', { period: 'weekly' })).toMatchObject({ enabled: false })

    expect(await client.data('list_boards')).toEqual([
      {
        path: 'Recto/Boards/Launch/Launch.md',
        name: 'Launch',
        lanes: [
          { title: 'To do', cards: 2 },
          { title: 'Doing', cards: 1 },
          { title: 'Done', cards: 2 },
        ],
      },
    ])
    const board = await client.data<{ lanes: { title: string; done_lane: boolean; cards: { text: string; note: string | null }[] }[] }>(
      'read_board',
      { board: 'Launch' },
    )
    expect(board.lanes[2]).toMatchObject({ title: 'Done', done_lane: true })
    expect(board.lanes[0]!.cards[0]).toMatchObject({ note: 'Recto/Boards/Launch/Write the announcement.md' })

    const open = await client.data<{ tasks: { text: string; status: string }[] }>('list_tasks', { status: 'open', board: 'Launch' })
    expect(open.tasks.map((t) => t.text).sort()).toEqual(['Fix the export bug', 'Record the demo', 'Write the announcement'])
  }, 30_000)

  it('hard rules: a taken name, a link to nothing, a board edited as text, an excluded folder', async () => {
    const taken = await client.call('propose_new_note', { name: 'basil', text: 'x' })
    expect(allText(taken)).toMatch(/A note “Basil” already exists in Garden\//)
    expect(allText(await client.call('propose_new_note', { name: 'A/B', text: 'x' }))).toMatch(/can't be used in a name/)
    expect(allText(await client.call('propose_new_note', { name: 'Fresh', text: 'See [[Nowhere]].' }))).toMatch(/links to no note/)
    expect(allText(await client.call('propose_new_note', { name: 'Fresh', text: 'See [b](Garden/Basil.md).' }))).toMatch(
      /written \[\[Note name\]\]/,
    )
    expect(allText(await client.call('propose_new_note', { name: 'Fresh', folder: 'Kitchen', text: 'x' }))).toMatch(/excluded from AI/)
    expect(allText(await client.call('propose_edit', { note: 'Launch', changes: [{ find: 'To do', replace: 'Todo' }] }))).toMatch(
      /is a board/,
    )
    expect(allText(await client.call('propose_edit', { note: 'Basil', changes: [{ find: 'nowhere in it', replace: 'x' }] }))).toMatch(
      /not in “Basil”/,
    )
  }, 30_000)

  it('a proposal waits, formatted to the profile; Apply writes it; get_proposal says so', async () => {
    const before = read('Garden/Basil.md')
    const proposed = await client.call('propose_append', { note: 'Basil', text: '## Harvest\n\nPick in the morning. See [[Soil]].' })
    const made = JSON.parse(proposed.content[0]!.text) as { outcome: string; proposal_id: string; formatted: string[] }
    expect(made).toMatchObject({ outcome: 'proposed', formatted: ['headingBlankAfter'] })
    expect(read('Garden/Basil.md')).toBe(before)
    expect(await client.data('get_proposal', { id: made.proposal_id })).toMatchObject({ status: 'pending' })

    const applied = await invoke(page, 'ai-proposals:apply', made.proposal_id)
    expect(applied).toEqual({ ok: true })
    // Only the appended lines were formatted: one blank before the heading, none after.
    expect(read('Garden/Basil.md')).toBe(`${before.replace(/\n+$/, '')}\n\n## Harvest\nPick in the morning. See [[Soil]].\n`)
    expect(await client.data('get_proposal', { id: made.proposal_id })).toMatchObject({ status: 'applied' })
  }, 30_000)

  it('a stale proposal writes nothing; Discard leaves the note alone', async () => {
    const first = JSON.parse(
      (await client.call('propose_edit', { note: 'Soil', changes: [{ find: 'Soil', replace: 'Good soil' }] })).content[0]!.text,
    ) as { proposal_id: string }
    fs.appendFileSync(path.join(vault, 'Garden/Soil.md'), '\nEdited by hand.\n')
    const result = await invoke(page, 'ai-proposals:apply', first.proposal_id)
    expect(result).toMatchObject({ ok: false, stale: true })
    expect(read('Garden/Soil.md')).toContain('Edited by hand.')

    const second = JSON.parse((await client.call('propose_link', { from: 'Handbook', to: 'Raised beds' })).content[0]!.text) as {
      proposal_id: string
    }
    const handbook = read('Handbook.md')
    expect(await invoke(page, 'ai-proposals:discard', second.proposal_id)).toEqual({ ok: true })
    expect(read('Handbook.md')).toBe(handbook)
  }, 30_000)

  it('tasks: a card as a note on a board, an update that moves it to Done; today’s note from its template', async () => {
    const card = JSON.parse(
      (await client.call('propose_task', { title: 'Ship it', board: 'Launch', due: '2026-12-01' })).content[0]!.text,
    ) as { proposal_id: string; paths: string[] }
    expect(card.paths).toEqual(['Recto/Boards/Launch/Ship it.md', 'Recto/Boards/Launch/Launch.md'])
    expect(await invoke(page, 'ai-proposals:apply', card.proposal_id)).toEqual({ ok: true })
    expect(read('Recto/Boards/Launch/Ship it.md')).toMatch(/due: 2026-12-01/)
    expect(read('Recto/Boards/Launch/Launch.md')).toMatch(/## To do\n\n- \[ \] \[\[Ship it\]\]/)

    const done = JSON.parse(
      (await client.call('propose_task_update', { board: 'Launch', card: 'Ship it', done: true })).content[0]!.text,
    ) as { proposal_id: string }
    expect(await invoke(page, 'ai-proposals:apply', done.proposal_id)).toEqual({ ok: true })
    expect(read('Recto/Boards/Launch/Launch.md')).toMatch(/\*\*Complete\*\*\n- \[x\] \[\[Ship it\]\]/)
    expect(read('Recto/Boards/Launch/Ship it.md')).toMatch(/completed: \d{4}-\d{2}-\d{2}/)

    const before = read(today.path)
    const daily = JSON.parse(
      (await client.call('propose_append', { periodic: { period: 'daily' }, text: '- Walked the garden' })).content[0]!.text,
    ) as { proposal_id: string }
    expect(await invoke(page, 'ai-proposals:apply', daily.proposal_id)).toEqual({ ok: true })
    // No blank line after a heading, by the profile.
    expect(read(today.path)).toBe(`${before.replace(/\n+$/, '')}\n- Walked the garden\n`)
  }, 30_000)

  it('every call is in the activity log, without note text', async () => {
    const log = fs.readFileSync(path.join(vault, '.recto', 'ai-activity.jsonl'), 'utf8')
    expect(log).toContain('"tool":"read_note"')
    expect(log).toContain('"client":"e2e"')
    expect(log).not.toContain('Pick in the morning')
  })

  it('write modes: read only refuses; write directly writes at once, after a backup', async () => {
    const settings_ = (mode: string): Promise<unknown> =>
      page.evaluate(async (m) => {
        const api = (window as unknown as WithApi).api
        const current = (await api.invoke('ai-access:settings')) as Record<string, unknown>
        return api.invoke('ai-access:set-settings', { ...current, writeMode: m })
      }, mode)
    await settings_('read')
    const refused = await client.call('propose_append', { note: 'Ideas', text: 'More.' })
    expect(refused.isError).toBe(true)
    expect(allText(refused)).toMatch(/read only/)

    await settings_('write')
    const before = read('Ideas.md')
    const written = JSON.parse((await client.call('propose_append', { note: 'Ideas', text: 'More.' })).content[0]!.text) as {
      outcome: string
    }
    expect(written.outcome).toBe('applied')
    expect(read('Ideas.md')).toBe(`${before.replace(/\n+$/, '')}\n\nMore.\n`)
    const backups = path.join(vault, '.recto', 'backup', 'ai')
    const [stamp] = fs.readdirSync(backups)
    expect(fs.readFileSync(path.join(backups, stamp!, 'Ideas.md'), 'utf8')).toBe(before)
  }, 30_000)
})
