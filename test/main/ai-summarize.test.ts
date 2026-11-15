import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Summarize with Claude" in a note's preview card: a cloud call like any
 * other. Off while Cloud is off, never for a note excluded from AI, and the
 * renderer gives only the note's path - the text and instructions are main's.
 */

let root = ''
let access: unknown = null
const sent: { system: string; messages: { content: string }[] }[] = []
vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => os.tmpdir() },
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (name: string) => (name.includes('ai-access') ? access : null),
  writeState: () => ({ ok: true }),
}))
vi.mock('../../src/main/secrets', () => ({ readKey: () => 'sk-test' }))
vi.mock('../../src/main/ai/provider', () => ({
  DirectProvider: class {
    async stream(request: { system: string; messages: { content: string }[] }): Promise<void> {
      sent.push(request)
    }
  },
}))

const { summarize } = await import('../../src/main/ai')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-summarize-'))
  sent.length = 0
  put('Garden/Basil.md', '# Basil\n\nPinch the tops.\n')
  put('Private/Diary.md', '# Diary\n\nDear diary.\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('Summarize with Claude', () => {
  it('Cloud off: refused, nothing sent', async () => {
    access = { excluded: [], cloud: false }
    expect(await summarize('a', 'Garden/Basil.md')).toMatchObject({ ok: false, error: expect.stringMatching(/Cloud providers are off/) })
    expect(sent).toEqual([])
  })

  it('a note in an excluded folder: refused, its text never sent', async () => {
    access = { excluded: ['Private'], cloud: true }
    expect(await summarize('b', 'Private/Diary.md')).toMatchObject({ ok: false, error: expect.stringMatching(/excluded from AI/) })
    expect(sent).toEqual([])
  })

  it('otherwise the note, read by main, with main’s own instructions', async () => {
    access = { excluded: ['Private'], cloud: true }
    expect(await summarize('c', 'Garden/Basil.md')).toEqual({ ok: true })
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.messages[0]!.content).toContain('Pinch the tops')
    expect(sent[0]!.system).toMatch(/^Summarise the user's note/)
  })
})
