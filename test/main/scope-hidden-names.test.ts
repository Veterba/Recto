import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A name an excluded note shares with a visible one: a tool given the name
 * finds the visible note, while a link in a note still means what it opens
 * for the person - the excluded one, so no note to the AI. Invented notes.
 */

let root = ''
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({
  readState: (n: string) => (n.includes('ai-access') ? { excluded: ['A'] } : null),
  writeState: () => ({ ok: true }),
}))
vi.mock('../../src/main/index-client', () => ({ send: async () => ({}) }))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { proposeAppend } = await import('../../src/main/vault-tools/write')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-hidden-names-'))
  // A/Plan.md is the shorter path: [[Plan]] from the top opens it.
  put('A/Plan.md', '# Plan\n')
  put('Work/Plan.md', '# Plan\n')
  put('Inbox.md', '# Inbox\n')
  put('A/pic.png', 'x')
  put('Work/Images/pic.png', 'x')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('a name an excluded note shares', () => {
  it('a tool given the name gets the visible note', () => {
    const scope = buildScope('test')
    expect(scope.need('Plan')).toBe('Work/Plan.md')
    expect(scope.resolve('Plan')).toBe('Work/Plan.md')
    expect(scope.needFile('pic.png')).toBe('Work/Images/pic.png')
  })

  it('a link in a note means what it opens: the excluded note, so none', () => {
    const scope = buildScope('test')
    expect(scope.resolve('Plan', 'Inbox.md')).toBeNull()
    expect(scope.resolve('Work/Plan', 'Inbox.md')).toBe('Work/Plan.md')
  })

  it('a link the AI writes that would open the excluded note is refused with the one to write', async () => {
    const scope = buildScope('test')
    await expect(proposeAppend(scope, { note: 'Inbox', text: 'See [[Plan]].' })).rejects.toThrow('[[plan]] does not lead to “Work/Plan.md” from this note. Write [[Work/Plan]].')
    await expect(proposeAppend(scope, { note: 'Inbox', text: 'See [[Work/Plan]].' })).resolves.toBeDefined()
  })
})
