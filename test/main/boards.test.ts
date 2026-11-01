import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardText, parseKanban } from '../../src/shared/kanban'

/**
 * Main's board operations on real files: a card's file follows the rules
 * when Recto takes it off a board, a board's rename takes its folder along,
 * and deleting a board sends the board note to the Trash and its cards to
 * Unsorted, another board or the Trash - never a card another board still
 * links, never a note from outside Recto's folders - with an undo for all of it.
 */

let root = ''
let trash = ''
vi.mock('electron', () => ({
  shell: {
    trashItem: async (file: string) => {
      fs.mkdirSync(trash, { recursive: true })
      fs.renameSync(file, path.join(trash, path.basename(file)))
    },
  },
  app: { on: () => undefined, getPath: () => os.tmpdir() },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/watcher', () => ({ markSelfWrite: () => undefined }))

const vaultFs = await import('../../src/main/vault-fs')
const { createBoardOps, ensureReadme } = await import('../../src/main/boards')

const A = 'Recto/Boards/A/A.md'
const B = 'Recto/Boards/B/B.md'
const board = (cards: string[], folder?: string): string =>
  boardText([{ title: 'To do', items: cards.map((text) => ({ text })) }, { title: 'Done', complete: true, items: [] }], {
    ...(folder === undefined ? {} : { 'new-note-folder': folder }),
  })

const put = (relative: string, content = ''): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative: string): boolean => fs.existsSync(path.join(root, relative))
const lines = (relative: string): string[] => parseKanban(read(relative)).lanes.flatMap((l) => l.items.map((i) => i.text))

let ops: ReturnType<typeof createBoardOps>
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-boards-'))
  trash = path.join(root, '..', `${path.basename(root)}-trash`)
  // A: a card only on A, a card also on B (its file in A's folder), a note from the Garden.
  put(A, board(['[[Only A]]', '[[Shared]]', '[[Basil]]', 'Buy stamps'], 'Recto/Boards/A'))
  put(B, board(['[[Shared]]', '[[Only B]]'], 'Recto/Boards/B'))
  put('Recto/Boards/A/Only A.md', 'only a')
  put('Recto/Boards/A/Shared.md', 'shared')
  put('Recto/Boards/B/Only B.md', 'only b')
  put('Garden/Basil.md', 'basil')
  ops = createBoardOps({
    relocate: async (_from, apply) => {
      const moved = await apply()
      return moved.ok ? { ok: true, path: moved.path, rewrittenFiles: 0, rewrittenLinks: 0 } : moved
    },
    listBoards: async () => [A, B].filter(exists),
  })
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(trash, { recursive: true, force: true })
})

describe('placing cards after a change in Recto', () => {
  it('a card taken off its only board goes to Unsorted', async () => {
    put(A, board(['[[Shared]]', '[[Basil]]'], 'Recto/Boards/A'))
    expect(await ops.placeCards(['Recto/Boards/A/Only A.md'])).toEqual([{ from: 'Recto/Boards/A/Only A.md', to: 'Recto/Unsorted/Only A.md' }])
    expect(read('Recto/Unsorted/Only A.md')).toBe('only a')
  })

  it('a card on two boards stays; taken off one, it goes to the other’s folder', async () => {
    expect(await ops.placeCards(['Recto/Boards/A/Shared.md'])).toEqual([])
    put(A, board(['[[Only A]]', '[[Basil]]'], 'Recto/Boards/A'))
    expect(await ops.placeCards(['Recto/Boards/A/Shared.md'])).toEqual([{ from: 'Recto/Boards/A/Shared.md', to: 'Recto/Boards/B/Shared.md' }])
  })

  it('a board the index does not list yet counts when it is passed in', async () => {
    put('Recto/Boards/C/C.md', board(['[[Only A]]']))
    put(A, board([], 'Recto/Boards/A'))
    expect(await ops.placeCards(['Recto/Boards/A/Only A.md'], ['Recto/Boards/C/C.md'])).toEqual([
      { from: 'Recto/Boards/A/Only A.md', to: 'Recto/Boards/C/Only A.md' },
    ])
  })

  it('never moves a note from outside Recto’s folders', async () => {
    put(A, board([], 'Recto/Boards/A'))
    expect(await ops.placeCards(['Garden/Basil.md'])).toEqual([])
    expect(read('Garden/Basil.md')).toBe('basil')
  })
})

describe('renaming a board', () => {
  it('renames its note and its folder, moves its cards along and points new-note-folder there', async () => {
    const result = await ops.renameBoard(A, 'Alpha')
    expect(result).toEqual({ ok: true, path: 'Recto/Boards/Alpha/Alpha.md' })
    expect(exists('Recto/Boards/A')).toBe(false)
    expect(read('Recto/Boards/Alpha/Only A.md')).toBe('only a')
    expect(read('Recto/Boards/Alpha/Shared.md')).toBe('shared')
    expect(parseKanban(read('Recto/Boards/Alpha/Alpha.md')).settings['new-note-folder']).toBe('Recto/Boards/Alpha')
    // Nothing else in the board changed.
    expect(lines('Recto/Boards/Alpha/Alpha.md')).toEqual(['[[Only A]]', '[[Shared]]', '[[Basil]]', 'Buy stamps'])
  })

  it('refuses a name with “/”, and changes nothing', async () => {
    expect(await ops.renameBoard(A, 'A/B')).toEqual({ ok: false, error: '“/” can\'t be used in a name' })
    expect(exists(A)).toBe(true)
  })

  it('refuses a name a note has anywhere, and changes nothing', async () => {
    const result = await ops.renameBoard(A, 'Basil')
    expect(result).toMatchObject({ ok: false })
    expect(exists(A)).toBe(true)
  })
})

describe('deleting a board', () => {
  it('to Unsorted: its own cards go there, a card B still links goes to B, an outside note stays put', async () => {
    const result = await ops.deleteBoard(A, { kind: 'unsorted' })
    expect(result).toMatchObject({ ok: true, trashed: [] })
    expect(read('Recto/Unsorted/Only A.md')).toBe('only a')
    expect(read('Recto/Boards/B/Shared.md')).toBe('shared')
    expect(read('Garden/Basil.md')).toBe('basil')
    expect(exists('Recto/Boards/A')).toBe(false)
    // The board note itself is in the Trash.
    expect(fs.readdirSync(trash)).toEqual(['A.md'])
  })

  it('to another board: its lines join that board (no second line for a card already there), files follow; undo puts it all back', async () => {
    const boardA = read(A)
    const boardB = read(B)
    const result = await ops.deleteBoard(A, { kind: 'board', to: B })
    expect(result).toMatchObject({ ok: true })
    expect(lines(B)).toEqual(['[[Shared]]', '[[Only B]]', '[[Only A]]', '[[Basil]]', 'Buy stamps'])
    expect(read('Recto/Boards/B/Only A.md')).toBe('only a')
    expect(read('Recto/Boards/B/Shared.md')).toBe('shared')
    expect(read('Garden/Basil.md')).toBe('basil')
    if (!result.ok) return
    expect(await ops.undoDelete(result.undoId!)).toEqual({ ok: true })
    expect(read(A)).toBe(boardA)
    expect(read(B)).toBe(boardB)
    expect(read('Recto/Boards/A/Only A.md')).toBe('only a')
    expect(read('Recto/Boards/A/Shared.md')).toBe('shared')
  })

  it('to the Trash: only cards no other board links, never an outside note; undo puts them and the board back', async () => {
    const result = await ops.deleteBoard(A, { kind: 'trash' })
    expect(result).toMatchObject({ ok: true, trashed: ['Recto/Boards/A/Only A.md'] })
    if (!result.ok) return
    expect(fs.readdirSync(trash).sort()).toEqual(['A.md', 'Only A.md'])
    expect(read('Recto/Boards/B/Shared.md')).toBe('shared')
    expect(read('Garden/Basil.md')).toBe('basil')

    expect(await ops.undoDelete(result.undoId!)).toEqual({ ok: true })
    expect(read('Recto/Boards/A/Only A.md')).toBe('only a')
    expect(exists(A)).toBe(true)
    // The card another board kept goes back beside A, where it was.
    expect(read('Recto/Boards/A/Shared.md')).toBe('shared')
    expect(await ops.undoDelete(result.undoId!)).toMatchObject({ ok: false })
  })
})

describe('the README', () => {
  it('is written once the Recto folder exists, as Recto README when a README is elsewhere', () => {
    expect(ensureReadme(root)).toBe('Recto/README.md')
    expect(read('Recto/README.md')).toMatch(/managed by Recto/)
    expect(ensureReadme(root)).toBeNull()

    fs.rmSync(path.join(root, 'Recto/README.md'))
    put('Docs/README.md', 'mine')
    expect(ensureReadme(root)).toBe('Recto/Recto README.md')
  })
})

describe('one name check, on disk', () => {
  it('finds the note that has a name anywhere, in any case', () => {
    expect(vaultFs.nameTakenBy('basil.md')).toBe('Garden/Basil.md')
    expect(vaultFs.nameTakenBy('Nothing.md')).toBeNull()
  })
})
