import { beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import type { BoardSummaryInfo, CardPlaceInfo } from '../../../../src/shared/index-results'
import { linkKindOf } from '../../../../src/renderer/app/link-kinds'
import { boardMade, refreshBoards } from '../../../../src/renderer/features/boards/boards-store'

/** What a link to a board or a card shows in the editor, from the index's boards and card places. */

let boards: BoardSummaryInfo[]
let places: CardPlaceInfo[]

beforeEach(() => {
  boards = [
    { path: 'tasks/Launch.md', name: 'Launch', cards: 3 },
    { path: 'tasks/Later.md', name: 'Later', cards: 1 },
  ]
  places = [
    { path: 'tasks/Todo.md', board: 'tasks/Launch.md', lane: 'To do', stage: 'open' },
    { path: 'tasks/Doing.md', board: 'tasks/Launch.md', lane: 'Review', stage: 'doing' },
    { path: 'tasks/Done.md', board: 'tasks/Launch.md', lane: 'Done', stage: 'done' },
    { path: 'tasks/Both.md', board: 'tasks/Launch.md', lane: 'Done', stage: 'done' },
    { path: 'tasks/Both.md', board: 'tasks/Later.md', lane: 'Someday', stage: 'open' },
    { path: 'tasks/Twice.md', board: 'tasks/Launch.md', lane: 'Done', stage: 'done' },
    { path: 'tasks/Twice.md', board: 'tasks/Later.md', lane: 'Done', stage: 'done' },
  ]
  const invoke = async (channel: string): Promise<unknown> => (channel === IPC.indexBoards ? boards : channel === IPC.indexCardPlaces ? places : null)
  ;(globalThis as unknown as { window: unknown }).window = { api: { invoke, on: () => () => undefined } }
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('link icons', () => {
  it('a board, and a card by where it stands: first lane, any lane between, done', async () => {
    refreshBoards()
    await settle()
    expect(linkKindOf('Launch')).toBe('board')
    expect(linkKindOf('tasks/Launch')).toBe('board')
    expect(linkKindOf('Todo')).toBe('open')
    expect(linkKindOf('doing')).toBe('doing')
    expect(linkKindOf('tasks/Done.md')).toBe('done')
    expect(linkKindOf('Plain note')).toBeUndefined()
  })

  it('a card on several boards: their stage when they agree, the neutral icon when not', async () => {
    refreshBoards()
    await settle()
    expect(linkKindOf('Twice')).toBe('done')
    expect(linkKindOf('Both')).toBe('mixed')
  })

  it('follows a move: the next answer from the index changes the icon', async () => {
    refreshBoards()
    await settle()
    places = places.map((p) => (p.path === 'tasks/Todo.md' ? { ...p, lane: 'Done', stage: 'done' } : p))
    refreshBoards()
    await settle()
    expect(linkKindOf('Todo')).toBe('done')
  })

  it('a board made a moment ago is a board before the index has read it', async () => {
    boardMade('Ideas/Fresh.md')
    expect(linkKindOf('Fresh')).toBe('board')
  })
})
