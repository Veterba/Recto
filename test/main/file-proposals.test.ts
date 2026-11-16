import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An AI suggesting a note be renamed, moved or archived: the tools' checks,
 * then the suggestion accepted (through the same relocate the file tree uses
 * - here a stand-in that only moves the file), undone, or out of date.
 * Invented notes.
 */

let root = ''
let saved: unknown = null
let access: unknown = null
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir() },
  shell: { trashItem: async () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (name: string) => (name.includes('proposals') ? saved : name.includes('ai-access') ? access : null),
  writeState: (name: string, value: unknown) => {
    if (name.includes('proposals')) saved = value
    return { ok: true }
  },
}))
vi.mock('../../src/main/index-client', () => ({ send: async () => ({ kind: 'backlinks-result', links: [] }) }))

const { callTool } = await import('../../src/main/vault-tools')
const proposals = await import('../../src/main/vault-tools/proposals')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const there = (relative: string): boolean => fs.existsSync(path.join(root, relative))
/** What the tool answered: its data, or its error. */
const propose = async (tool: string, args: Record<string, unknown>): Promise<{ id?: string; error?: string }> => {
  const out = await callTool(tool, args, 'claude-code')
  if (!out.ok) return { error: out.error }
  return { id: (out.blocks[0] as { data: { proposal_id: string } }).data.proposal_id }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-file-prop-'))
  saved = null
  access = { excluded: ['Private'], cloud: true }
  put('Garden/Basil.md', '# Basil\n')
  put('Kitchen/Pesto.md', 'Uses [[Basil]].\n')
  put('Private/Diary.md', '# Diary\n')
  put('Recto/Boards/Launch/Launch.md', '---\nkanban-plugin: board\n---\n\n## To do\n\n')
  // The file tree's relocate, without the links: enough to see the file go and come back.
  proposals.setRelocate(async (from, to) => {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
    fs.renameSync(path.join(root, from), path.join(root, to))
    return { ok: true, path: to }
  })
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('suggesting a rename, a move, an archive', () => {
  it('a rename: suggested, nothing moved yet; accepted, the note is renamed; undone, it is back', async () => {
    const { id } = await propose('propose_rename', { note: 'Basil', name: 'Basil (Genovese)' })
    expect(there('Garden/Basil.md')).toBe(true)
    expect(proposals.proposal(id!)).toMatchObject({
      status: 'pending',
      file: { kind: 'rename', from: 'Garden/Basil.md', to: 'Garden/Basil (Genovese).md' },
    })
    expect(await proposals.apply(id!)).toEqual({ ok: true })
    expect(there('Garden/Basil (Genovese).md')).toBe(true)
    expect(there('Garden/Basil.md')).toBe(false)
    expect(await proposals.undo(id!)).toEqual({ ok: true })
    expect(there('Garden/Basil.md')).toBe(true)
    expect(proposals.proposal(id!)?.file?.undone).toBe(true)
    // Once only.
    expect(await proposals.undo(id!)).toMatchObject({ ok: false })
  })

  it('a move keeps the name; an archive is restored by Undo', async () => {
    const moved = await propose('propose_move', { note: 'Basil', folder: 'Kitchen' })
    expect(await proposals.apply(moved.id!)).toEqual({ ok: true })
    expect(there('Kitchen/Basil.md')).toBe(true)

    const archived = await propose('propose_delete', { note: 'Pesto' })
    expect(await proposals.apply(archived.id!)).toEqual({ ok: true })
    expect(there('Kitchen/Pesto.md')).toBe(false)
    expect(proposals.proposal(archived.id!)?.file?.archive).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    expect(await proposals.undo(archived.id!)).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(root, 'Kitchen/Pesto.md'), 'utf8')).toBe('Uses [[Basil]].\n')
  })

  it('a note moved or a name taken since: out of date, nothing moved; rejected: nothing moved', async () => {
    const gone = await propose('propose_rename', { note: 'Basil', name: 'Sweet basil' })
    fs.renameSync(path.join(root, 'Garden/Basil.md'), path.join(root, 'Garden/Holy basil.md'))
    expect(await proposals.apply(gone.id!)).toMatchObject({ ok: false, stale: true })
    expect(proposals.proposal(gone.id!)?.status).toBe('stale')

    const taken = await propose('propose_move', { note: 'Pesto', folder: 'Garden' })
    put('Garden/Pesto.md', 'Another pesto.\n')
    expect(await proposals.apply(taken.id!)).toMatchObject({ ok: false, stale: true })
    expect(there('Kitchen/Pesto.md')).toBe(true)

    const left = await propose('propose_delete', { note: 'Holy basil' })
    expect(proposals.discard(left.id!)).toEqual({ ok: true })
    expect(proposals.proposal(left.id!)?.status).toBe('discarded')
    expect(there('Garden/Holy basil.md')).toBe(true)
  })

  it('in Write directly, an app outside Recto renames at once - no suggestion waits', async () => {
    access = { excluded: ['Private'], cloud: true, writeMode: 'write' }
    const out = await callTool('propose_rename', { note: 'Basil', name: 'Thai basil' }, 'claude-code')
    expect(out.ok && out.blocks[0]).toMatchObject({ data: { outcome: 'applied', paths: ['Garden/Basil.md', 'Garden/Thai basil.md'] } })
    expect(there('Garden/Thai basil.md')).toBe(true)
  })

  it('refused: a board, a name taken in the folder, a folder excluded from AI, a name with a slash', async () => {
    expect((await propose('propose_delete', { note: 'Recto/Boards/Launch/Launch.md' })).error).toMatch(/board/)
    put('Garden/Pesto.md', 'x\n')
    expect((await propose('propose_move', { note: 'Kitchen/Pesto.md', folder: 'Garden' })).error).toMatch(/already/)
    expect((await propose('propose_move', { note: 'Basil', folder: 'Private' })).error).toMatch(/excluded/)
    expect((await propose('propose_rename', { note: 'Basil', name: 'Herbs/Basil' })).error).toMatch(/propose_move/)
    expect((await propose('propose_rename', { note: 'Diary', name: 'Journal' })).error).toMatch(/No note/)
  })

  it('withdrawn by the app that suggested it, while it waits - not another app’s, not one decided', async () => {
    const { id } = await propose('propose_rename', { note: 'Basil', name: 'Sweet basil' })
    const withdraw = (client: string) => callTool('withdraw_proposal', { id }, client)
    expect(await withdraw('codex')).toMatchObject({ ok: false })
    expect(proposals.proposal(id!)?.status).toBe('pending')
    expect(await withdraw('claude-code')).toMatchObject({ ok: true })
    expect(proposals.proposal(id!)?.status).toBe('discarded')
    expect(there('Garden/Basil.md')).toBe(true)
    expect(await withdraw('claude-code')).toMatchObject({ ok: false, error: expect.stringMatching(/no longer waiting/) })
  })

  it('a canvas suggestion answers with the canvas as it will be: its id, each new or moved card’s place, what goes', async () => {
    put(
      'Recto/Canvas/Beds.canvas',
      JSON.stringify({
        nodes: [
          { id: 'aaaaaaaaaaaaaaaa', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 100 },
          { id: 'bbbbbbbbbbbbbbbb', type: 'text', text: 'Old', x: 0, y: 300, width: 200, height: 100 },
        ],
        edges: [],
      }),
    )
    const out = await callTool('canvas_propose_nodes', { canvas: 'Beds', nodes: [{ text: 'Compost', near: 'n1' }] }, 'claude-code')
    expect(out.ok).toBe(true)
    const blocks = out.ok ? out.blocks : []
    const head = (blocks[0] as { data: { proposal_id: string; hint: string } }).data
    expect(head.hint).toContain(head.proposal_id)
    const seen = (blocks[1] as { data: { as_it_will_be: { new_or_moved: { id: string; new: boolean; x: number; y: number; width: number; height: number }[] }; check: string } }).data
    const [compost] = seen.as_it_will_be.new_or_moved
    expect(seen.as_it_will_be.new_or_moved).toHaveLength(1)
    expect(compost).toMatchObject({ id: 'n3', new: true })
    // Where Recto put it: clear of Soil.
    const clear = compost!.x + compost!.width <= 0 || compost!.x >= 200 || compost!.y + compost!.height <= 0 || compost!.y >= 100
    expect(clear).toBe(true)
    expect(seen.check).toContain(head.proposal_id)

    const removed = await callTool('canvas_propose_remove', { canvas: 'Beds', nodes: ['n2'] }, 'claude-code')
    expect(removed.ok && (removed.blocks[1] as { data: { as_it_will_be: { removed: string[] } } }).data.as_it_will_be.removed).toEqual(['n2'])
  })
})


describe('calls a model gets wrong', () => {
  it('an unknown tool is answered with the tools there are', async () => {
    const out = await callTool('make_coffee', {}, 'claude-code')
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/Recto has no tool “make_coffee”\. The tools are: get_ai_guide, .*read_note/) })
  })

  it('an argument the tool does not take is said back, not dropped unseen; a note name starting with a dot is refused', async () => {
    const out = await callTool('propose_rename', { note: 'Basil', name: 'Sweet basil', folder: 'Herbs' }, 'claude-code')
    expect(out.ok).toBe(true)
    const said = out.ok ? (out.blocks[0] as { data: { ignored_arguments: string[]; note: string } }).data : null
    expect(said).toMatchObject({ ignored_arguments: ['folder'], note: expect.stringMatching(/propose_rename takes note, name; these were left out/) })
    const hidden = await callTool('propose_rename', { note: 'Basil', name: '.basil' }, 'claude-code')
    expect(hidden).toMatchObject({ ok: false, error: expect.stringMatching(/starting with a dot/) })
  })
})
