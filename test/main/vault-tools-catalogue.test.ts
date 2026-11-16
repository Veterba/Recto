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
