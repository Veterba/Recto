import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ACCESS_STATE } from '../../src/shared/ai-access'

/**
 * What Quick ask is given about an open canvas: the selection (a group with
 * what it holds) or all of it - cards, notes with the start of their text,
 * arrows - and never a note AI may not see, not even its name.
 */

let root = ''
const state: Record<string, unknown> = {}
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({ readState: (feature: string) => state[feature] ?? null, writeState: () => ({ ok: true }) }))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { canvasContext } = await import('../../src/main/vault-tools/canvas-context')

const put = (relative: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const CANVAS = 'Recto/Canvas/Plan.canvas'
const node = (id: string, type: string, x: number, y: number, rest: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type,
  x,
  y,
  width: 100,
  height: 60,
  ...rest,
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-canvas-ctx-'))
  state[AI_ACCESS_STATE] = { excluded: ['Private'] }
  put('Garden/Basil.md', '# Basil\n\nSow in spring, pinch the flowers.\n')
  put('Private/Diary.md', '# Diary\n\nsecret words\n')
  put(
    CANVAS,
    JSON.stringify({
      nodes: [
        node('g1', 'group', 0, 0, { width: 400, height: 300, label: 'Herbs' }),
        node('n1', 'file', 10, 10, { file: 'Garden/Basil.md' }),
        node('t1', 'text', 150, 10, { text: 'Water daily\nin summer' }),
        node('p1', 'file', 600, 10, { file: 'Private/Diary.md' }),
        node('t2', 'text', 600, 200, { text: 'Far away card' }),
      ],
      edges: [
        { id: 'e1', fromNode: 'n1', toNode: 't1', label: 'needs' },
        { id: 'e2', fromNode: 't2', toNode: 'p1' },
      ],
    }),
  )
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('a canvas, as Quick ask is given it', () => {
  it('nothing selected: all of it, and an unseen note only as a place', async () => {
    const context = (await canvasContext(buildScope('test'), CANVAS, [], 3000))!
    expect(context.text).toContain('The whole canvas “Plan”')
    expect(context.text).toContain('- n1 · Group “Herbs”, holding: note “Basil”, card “Water daily”')
    expect(context.text).toContain('- n3 · Card: Water daily\nin summer')
    expect(context.text).toContain('- note “Basil” → card “Water daily” (“needs”)')
    expect(context.text).toContain('- card “Far away card” → a note AI may not see')
    expect(context.text).toContain('Sow in spring')
    expect(context.text).not.toMatch(/Diary|secret/)
    expect([...context.notes]).toEqual(['Garden/Basil.md'])
  })

  it('a selected group brings what it holds; the rest is left out', async () => {
    const context = (await canvasContext(buildScope('test'), CANVAS, ['g1'], 3000))!
    expect(context.text).toContain('3 selected on the canvas “Plan”')
    expect(context.text).not.toContain('Far away card')
    expect(context.text).toContain('(“needs”)')
  })

  it('the map of the canvas always goes; the notes’ text only as far as the budget', async () => {
    const context = (await canvasContext(buildScope('test'), CANVAS, [], 10))!
    expect(context.text).toContain('note “Basil”')
    expect(context.text).not.toContain('Sow in spring')
  })

  it('a canvas in a folder AI may not see is not read at all', async () => {
    put('Private/Ideas.canvas', JSON.stringify({ nodes: [], edges: [] }))
    expect(await canvasContext(buildScope('test'), 'Private/Ideas.canvas', [], 3000)).toBeNull()
  })
})
