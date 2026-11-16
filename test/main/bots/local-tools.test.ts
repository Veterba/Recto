import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp', on: () => undefined },
  shell: {},
  powerMonitor: { isOnBatteryPower: () => false, getSystemIdleTime: () => 999 },
}))
vi.mock('../../../src/main/index-client', () => ({ send: vi.fn() }))
vi.mock('../../../src/main/vault', () => ({ currentVault: () => null }))
/** The vault tools as the session runs them: a note read, recorded in the session as any AI's read is. */
const calls: { name: string; args: unknown; session: string | undefined }[] = []
vi.mock('../../../src/main/vault-tools', async () => {
  const { sessionNamed } = await import('../../../src/main/vault-tools/sessions')
  return {
    callTool: async (name: string, args: Record<string, unknown>, _client: string, session?: string) => {
      calls.push({ name, args, session })
      if (name === 'read_file') return { ok: true, blocks: [{ kind: 'image', path: 'a.png', mime: 'image/png', data: 'QUJD' }] }
      sessionNamed(session)?.record.read.add('Garden/Soil.md')
      return { ok: true, blocks: [{ kind: 'note', path: 'Garden/Soil.md', text: 'Compost, loam and grit.' }] }
    },
  }
})

const { answerWithTools, LAST_LOOKUP, MAX_CALLS, runTool, TOOL_SPECS } = await import('../../../src/main/bots/model-tools')
const { NOT_SEEN } = await import('../../../src/shared/vault-tools')
import type { BotModelProvider, ChatEvent, ChatTurn } from '../../../src/main/bots/provider'
import type { BotStep } from '../../../src/shared/bots'

const note = (p: string): Record<string, unknown> => ({ path: p, title: p.replace(/^.*\//, '').replace(/\.md$/, ''), mtime: 0, size: 0, noteDate: null, linksOut: 0, linksIn: 0, properties: {} })
const context = (extra: Record<string, unknown> = {}) =>
  ({
    bot: { id: 'recto', name: 'Recto', exclude: [] },
    catalog: [note('School/Unit 4.md'), note('School/Unit 5.md'), note('Garden/Soil.md')],
    vaultNotes: [
      { path: 'School/Unit 4.md', title: 'Unit 4', aliases: [] },
      { path: 'School/Unit 5.md', title: 'Unit 5', aliases: [] },
    ],
    folders: [],
    topics: [],
    budget: 4000,
    ...extra,
  }) as never

/** A model that asks for `asks` in turn, then answers; what it was sent each time is kept. */
function model(asks: { name: string; args: Record<string, unknown> }[][], sees = false): { provider: BotModelProvider; sent: ChatTurn[][]; offered: number[] } {
  const sent: ChatTurn[][] = []
  const offered: number[] = []
  let i = 0
  const provider = {
    stream: async function* () {},
    canSee: async () => sees,
    streamChat: async function* (turns: ChatTurn[], _system: string, tools: unknown[]): AsyncIterable<ChatEvent> {
      sent.push([...turns])
      offered.push(tools.length)
      const now = asks[i++]
      if (now === undefined) yield { type: 'text', text: 'Done.' }
      else yield { type: 'tools', calls: now }
    },
  } as unknown as BotModelProvider
  return { provider, sent, offered }
}

const drain = async (provider: BotModelProvider, onStep?: (s: BotStep) => void, result = { calls: [] as unknown[], parseFailures: 0 } as never) => {
  for await (const _ of answerWithTools(provider, [{ role: 'user', content: 'Soil?' }], 'S', { model: 'm', signal: new AbortController().signal, advisor: false, context: context(), result, ...(onStep ? { onStep } : {}) })) void _
  return result as { calls: { notes: string[] }[]; read?: string[] }
}

describe('the local chat’s tools', () => {
  it('reads with the vault tools every AI has, in a session of the answer’s: its reads are the answer’s sources and steps', async () => {
    calls.length = 0
    const steps: BotStep[] = []
    const { provider } = model([[{ name: 'read_note', args: { note: 'Soil' } }]])
    const result = await drain(provider, (s) => steps.push(s))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.session).toBeDefined()
    expect(result.read).toEqual(['Garden/Soil.md'])
    expect(steps).toEqual([{ action: 'Opened', result: '“Soil”', state: 'done' }])
    // The same definitions as the cloud chats and MCP: argument `note`, not a title of its own.
    expect(TOOL_SPECS.find((t) => t.function.name === 'read_note')!.function.parameters.properties).toHaveProperty('note')
  })

  it('says when it has used its last lookup, and offers no more', async () => {
    const ask = { name: 'read_note', args: { note: 'Soil' } }
    const { provider, sent, offered } = model(Array.from({ length: MAX_CALLS }, () => [ask]))
    await drain(provider)
    expect(offered.at(-1)).toBe(0)
    const last = sent.at(-1)!.findLast((t) => t.role === 'tool')!
    expect(last.content.endsWith(LAST_LOOKUP)).toBe(true)
  })

  it('a picture a tool returned: shown to a model that sees, said not shown to one that does not', async () => {
    const ask = [[{ name: 'read_file', args: { file: 'a.png' } }]]
    const blind = model(ask, false)
    await drain(blind.provider)
    expect(blind.sent.at(-1)!.find((t) => t.role === 'tool')!.content).toContain(NOT_SEEN)
    const seeing = model(ask, true)
    await drain(seeing.provider)
    const turns = seeing.sent.at(-1)!
    expect(turns.find((t) => t.role === 'tool')!.content).not.toContain(NOT_SEEN)
    expect(turns.at(-1)).toMatchObject({ role: 'user', images: [{ mime: 'image/png', data: 'QUJD' }] })
  })

  it('finds a note by its exact name, never a neighbour’s; checks dates; names the tools when asked for one it lacks', async () => {
    expect((await runTool('note_outline', { note: 'Unit 6' }, context())).text).toMatch(/^No note "Unit 6"\. Closest names:/)
    expect((await runTool('tasks_in_period', { from: '2026-02-30', to: '2026-03-01' }, context())).text).toMatch(/real days/)
    expect((await runTool('notes_in_period', { from: 'last week' }, context())).text).toMatch(/real days/)
    const none = (await runTool('make_coffee', {}, context())).text
    expect(none).toMatch(/There is no tool "make_coffee"\. The tools are: search_notes, read_note, read_file/)
  })
})
