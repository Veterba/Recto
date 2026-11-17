import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A topic written into a note only over the note as it was read: one that changed meanwhile is left for the next run. */

let root = ''
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { editLinks, writeNote } = await import('../../../src/main/topics/writes')

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-topic-writes-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const note = (text: string): void => fs.writeFileSync(path.join(root, 'Soil.md'), text)
const read = (): string => fs.readFileSync(path.join(root, 'Soil.md'), 'utf8')

describe('topic writes', () => {
  it('a note typed in since it was read is not written over', async () => {
    const was = '# Soil\n'
    note('# Soil\nTyped since.\n')
    expect(await writeNote('Soil.md', was, 'topics', ['[[Garden]]'])).toBe('changed')
    expect(read()).toBe('# Soil\nTyped since.\n')
  })

  it('as read, it is written', async () => {
    note('# Soil\n')
    expect(await writeNote('Soil.md', '# Soil\n', 'topics', ['[[Garden]]'])).toBe(true)
    expect(read()).toMatch(/topics:[\s\S]*Garden/)
  })

  it('an edit made at once reads the note again and is made on it as it is', async () => {
    note('---\ntopics:\n  - "[[Garden]]"\n  - "[[Kitchen]]"\n---\n# Soil\n')
    expect(await editLinks('Soil.md', 'topics', (entries) => entries.filter((e) => !e.includes('Kitchen')))).toBe(true)
    expect(read()).not.toContain('Kitchen')
    expect(read()).toContain('Garden')
  })
})
