import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'

/** The AI activity log names what a client did, never the text it read or wrote: it lives in the vault, and syncs. */

vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: os.tmpdir(), name: 'v' }) }))
const { summariseArgs } = await import('../../src/main/vault-tools/activity')

describe('the activity log', () => {
  it("keeps a canvas's cards, a card, a heading and a search as their length; paths and names as they are", () => {
    const line = summariseArgs({
      note: 'Garden/Basil',
      nodes: [{ text: 'SECRET card text' }],
      edges: [{ from: 'n1', to: 'n2', label: 'SECRET label' }],
      card: 'SECRET card',
      under_heading: 'SECRET heading',
      query: 'SECRET search',
      new_links: ['SECRET link'],
    })
    expect(line).not.toContain('SECRET')
    expect(line).toContain('note: Garden/Basil')
    expect(line).toMatch(/nodes: <\d+ chars>/)
  })
})
