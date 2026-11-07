import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Quick ask reads only the open note and its neighbours, but a note it may not
 * read is not a missing note: the context lists every link of the open note as
 * existing or not, read_note does the same for the links of a note it reads,
 * and the backlink count goes along. The notes are a copy of the demo vault's
 * "Japan trip plan" and the notes around it (invented for the demo).
 */

let root = ''
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({ readState: () => null, writeState: () => ({ ok: true }) }))
// The index: who links to the plan.
vi.mock('../../src/main/index-client', () => ({
  send: async (request: { kind: string; path?: string }) => ({
    kind: 'backlinks-result',
    links: request.path === 'Projects/Japan trip/Japan trip plan.md' ? [{ path: 'Daily/2026-11-07.md', line: 1 }, { path: 'Areas/Photography.md', line: 3 }] : [],
  }),
}))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { noteContext, readNoteTool } = await import('../../src/main/vault-tools/read')

const TRIP = 'Projects/Japan trip'
const PLAN = `${TRIP}/Japan trip plan.md`
const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const dataOf = (blocks: unknown[]): Record<string, unknown> => (blocks[0] as { data: Record<string, unknown> }).data

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-ask-links-'))
  put(
    PLAN,
    [
      '*A note about how the trip hangs together, written as I go*',
      '',
      'Thirteen days, four bases, one rule: ==no more than one big thing a day==.',
      '',
      '## The shape of it',
      '',
      'Tokyo for four nights, one night in Hakone, then the long middle stretch in [[Kyoto]], and Osaka at the end. The day-by-day lives in [[Itinerary]], the money in [[Budget]].',
      '',
      'Still to book: [[Osaka hotel]].',
    ].join('\n'),
  )
  put(`${TRIP}/Itinerary.md`, '| Day | Base |\n| --- | --- |\n| 1 | [[Tokyo]] |\n| 6 | [[Kyoto]] |\n| 11 | [[Osaka]] |\n')
  for (const name of ['Kyoto', 'Tokyo', 'Osaka', 'Budget']) put(`${TRIP}/${name}.md`, `*A note about ${name}*\n`)
  put('Daily/2026-11-07.md', 'Finish the [[Japan trip plan]].\n')
  put('Areas/Photography.md', 'See the [[Japan trip plan]].\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

/** Quick ask's reach for the plan: the note, the notes it links to, the notes linking to it. */
const reach = (): ReturnType<typeof buildScope> =>
  buildScope('quick-ask', {
    notes: new Set([PLAN, `${TRIP}/Itinerary.md`, `${TRIP}/Kyoto.md`, `${TRIP}/Budget.md`, 'Daily/2026-11-07.md', 'Areas/Photography.md']),
  })

describe('Quick ask: the links of the open note', () => {
  it('lists every link as existing or missing, and how many notes link to it', async () => {
    const data = dataOf(await noteContext(reach(), { note: PLAN, budget_tokens: 2000 }))
    expect(data['links']).toEqual([
      { target: 'Kyoto', exists: true, readable: true },
      { target: 'Itinerary', exists: true, readable: true },
      { target: 'Budget', exists: true, readable: true },
      { target: 'Osaka hotel', exists: false, readable: false },
    ])
    expect(data['backlinks']).toBe(2)
  })

  it('a note beyond reach is there, not missing: read_note says so for the links of a note it reads', async () => {
    const data = dataOf(await readNoteTool(reach(), { note: `${TRIP}/Itinerary.md`, offset: 0, max_chars: 4000 }))
    expect(data['links_out']).toEqual([
      { target: 'Tokyo', path: null, exists: true },
      { target: 'Kyoto', path: `${TRIP}/Kyoto.md`, exists: true },
      { target: 'Osaka', path: null, exists: true },
    ])
  })
})
