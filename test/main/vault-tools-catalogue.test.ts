import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'

/**
 * The tool catalogue (shared/vault-tools.ts) and the handlers (main/vault-tools/index.ts) say the same:
 * every tool has its handler, and every handler a tool - a handler keyed by a name no tool has was never
 * reachable, a tool without one answered "no such tool". Writes are the WRITERS and only them.
 */

vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir(), isPackaged: false }, shell: {}, safeStorage: {} }))
vi.mock('../../src/main/index-client', () => ({ send: async () => null }))

const { READERS, WRITERS } = await import('../../src/main/vault-tools')
const { VAULT_TOOLS } = await import('../../src/shared/vault-tools')

describe('the tool catalogue and its handlers', () => {
  it('match one to one', () => {
    const handled = [...Object.keys(READERS), ...Object.keys(WRITERS)].sort()
    expect(handled).toEqual(VAULT_TOOLS.map((t) => t.name).sort())
  })

  it('a tool marked as a write is a writer, and only those', () => {
    expect(VAULT_TOOLS.filter((t) => t.write).map((t) => t.name).sort()).toEqual(Object.keys(WRITERS).sort())
  })

  it('taking back a suggestion is marked as changing state, not as reading', () => {
    expect(VAULT_TOOLS.find((t) => t.name === 'withdraw_proposal')).toMatchObject({ write: false, changes: true })
  })
})

describe('what a model is told, for the tools it has', () => {
  it('an error leaves out a sentence or an aside sending it to a tool it does not have', async () => {
    const { forTools } = await import('../../src/shared/vault-tools')
    const quick = new Set(['read_note', 'propose_edit'])
    expect(forTools('No note “X” in this vault. Use search_notes to find it.', quick)).toBe('No note “X” in this vault.')
    expect(forTools('Give board (a card on a board, see list_boards) or note (a "- [ ]" line in a note).', quick)).toBe(
      'Give board or note (a "- [ ]" line in a note).',
    )
    // With every tool, the error as it was.
    expect(forTools('No note “X” in this vault. Use search_notes to find it.', null)).toBe('No note “X” in this vault. Use search_notes to find it.')
  })

  it('the server’s instructions name only tools the session has, and not the guide when it is already given', async () => {
    const { serverInstructions } = await import('../../src/shared/vault-tools')
    expect(serverInstructions()).toMatch(/Call get_ai_guide and get_vault_profile before writing anything/)
    expect(serverInstructions(['get_ai_guide', 'read_note', 'propose_edit'])).not.toMatch(/get_vault_profile/)
    expect(serverInstructions(null, true)).toMatch(/Call get_vault_profile before writing/)
    // Read-only tools: nothing about writing.
    expect(serverInstructions(['read_note'])).not.toMatch(/writ/i)
  })
})
