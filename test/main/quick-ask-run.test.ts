import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BotModelProvider } from '../../src/main/bots/provider'

/**
 * Quick ask's own run: a note it could not reach is told apart from a note in
 * an excluded folder, and a question sent again while the first is starting
 * leaves Stop working on the new one and nothing from the old one on screen.
 * A stand-in local model and index; invented notes.
 */

let root = ''
let access: unknown = null
/** What the index does with the next backlinks request. */
let index: () => Promise<unknown> = async () => ({ kind: 'backlinks-result', links: [] })
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir(), isPackaged: false },
  shell: {},
  safeStorage: {},
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (name: string) => (name.includes('ai-access') ? access : null),
  writeState: () => ({ ok: true }),
}))
vi.mock('../../src/main/index-client', () => ({ send: () => index() }))

const { quickAsk, cancelQuickAsk } = await import('../../src/main/providers/quick-ask')

/** Says "Fine." a word at a time, slowly enough to be stopped. */
const local = {
  async *stream(_m: unknown, _s: string, o: { signal?: AbortSignal }) {
    for (const w of ['Fi', 'ne.']) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 300)
        o.signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))))
      })
      yield w
    }
  },
} as unknown as BotModelProvider

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
type Event = { thread: string; type: string; problem?: { kind: string; message: string }; text?: string }
const ask = (thread: string, note: string, events: Event[]): Promise<void> =>
  quickAsk({ thread, note, model: 'ollama:test', history: [], question: 'What is this?' }, local, (e) => events.push(e as Event))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-quick-run-'))
  access = { excluded: ['Private'] }
  index = async () => ({ kind: 'backlinks-result', links: [] })
  put('Garden/Basil.md', '# Basil\n\nPinch the tops.\n')
  put('Private/Diary.md', '# Diary\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('Quick ask, run by run', () => {
  it('a note it could not reach is said as such, not as an excluded folder', async () => {
    index = async () => {
      throw new Error('the index is rebuilding')
    }
    const events: Event[] = []
    await ask('t1', 'Garden/Basil.md', events)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        problem: expect.objectContaining({
          kind: 'failed',
          message: expect.stringMatching(/could not read “Basil” just now: .*the index is rebuilding/),
        }),
      }),
    ])
  })

  it('a note in an excluded folder is said to be one', async () => {
    const events: Event[] = []
    await ask('t2', 'Private/Diary.md', events)
    expect(events[0]?.problem?.kind).toBe('excluded')
  })

  it('sent again while the first is starting: the first says nothing, and Stop stops the second', async () => {
    let release = (): void => undefined
    index = () => new Promise((resolve) => (release = () => resolve({ kind: 'backlinks-result', links: [] })))
    const first: Event[] = []
    const one = ask('t3', 'Garden/Basil.md', first)
    index = async () => ({ kind: 'backlinks-result', links: [] })
    const second: Event[] = []
    const two = ask('t3', 'Garden/Basil.md', second)
    release()
    await one
    await vi.waitFor(() => expect(second.some((e) => e.type === 'text')).toBe(true))
    cancelQuickAsk('t3')
    await two
    expect(first).toEqual([])
    expect(second.at(-1)?.type).toBe('cancelled')
  })
})
