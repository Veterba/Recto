import { describe, expect, it } from 'vitest'
import { MIN_GAP, placeAt, sortColumn } from '../src/renderer/board/ordering'
import { DEFAULT_BOARDS, columnId, columnOf, parseBoards } from '../src/renderer/board/boards'

describe('fractional ordering', () => {
  it('gives the first card in an empty column a real number', () => {
    expect(placeAt([], 0)).toEqual({ kind: 'order', order: 1 })
  })

  it('appends past the end', () => {
    expect(placeAt([1, 2, 3], 3)).toEqual({ kind: 'order', order: 4 })
  })

  it('prepends before the first', () => {
    expect(placeAt([1, 2, 3], 0)).toEqual({ kind: 'order', order: 0 })
  })

  it('splits the gap when dropped between two cards', () => {
    expect(placeAt([1, 2], 1)).toEqual({ kind: 'order', order: 1.5 })
  })

  it('touches exactly one card, which is the entire point', () => {
    // The result is a single number. Nothing about the other cards changes, so
    // a drag is one file write rather than a rewrite of the column.
    const result = placeAt([1, 2, 3, 4, 5], 2)
    expect(result.kind).toBe('order')
  })

  it('survives repeated drops into the same gap', () => {
    let column = [0, 1]
    for (let i = 0; i < 30; i++) {
      const placed = placeAt(column, 1)
      if (placed.kind === 'renumber') return // handled below
      expect(placed.order).toBeGreaterThan(column[0]!)
      expect(placed.order).toBeLessThan(column[1]!)
      column = [column[0]!, placed.order]
    }
  })

  it('asks for a renumber once the gap is exhausted instead of colliding', () => {
    // Halving a gap is not free forever. Without this the two cards end up with
    // the same order and the column order becomes arbitrary.
    const placed = placeAt([1, 1 + MIN_GAP / 2], 1)
    expect(placed).toEqual({ kind: 'renumber', orders: [1, 2, 3] })
  })
})

describe('column sorting', () => {
  const card = (title: string, order: number | null) => ({ title, order })

  it('orders by the fractional index', () => {
    const sorted = sortColumn([card('c', 3), card('a', 1), card('b', 2)])
    expect(sorted.map((c) => c.title)).toEqual(['a', 'b', 'c'])
  })

  it('puts never-dragged cards last, alphabetically', () => {
    const sorted = sortColumn([card('z', null), card('a', null), card('m', 5)])
    expect(sorted.map((c) => c.title)).toEqual(['m', 'a', 'z'])
  })

  it('breaks a tie by title rather than flickering', () => {
    // Two notes hand-edited to the same order is a real thing that happens.
    const sorted = sortColumn([card('b', 2), card('a', 2)])
    expect(sorted.map((c) => c.title)).toEqual(['a', 'b'])
  })
})

describe('boards.json', () => {
  it('falls back to a default board for a missing or broken file', () => {
    expect(parseBoards(null)).toEqual(DEFAULT_BOARDS)
    expect(parseBoards('nope')).toEqual(DEFAULT_BOARDS)
    expect(parseBoards({ boards: 'nope' })).toEqual(DEFAULT_BOARDS)
    expect(parseBoards({ boards: [] })).toEqual(DEFAULT_BOARDS)
  })

  it('reads a file it wrote', () => {
    const file = { boards: [{ id: 'work', name: 'Work', columns: [{ id: 'now', name: 'Now' }] }] }
    expect(parseBoards(file)).toEqual(file)
  })

  it('drops a board with no usable columns rather than rendering an empty board', () => {
    expect(parseBoards({ boards: [{ id: 'a', columns: [] }] })).toEqual(DEFAULT_BOARDS)
  })

  it('drops duplicate ids, which would make two columns claim the same cards', () => {
    const parsed = parseBoards({
      boards: [{ id: 'a', columns: [{ id: 'x' }, { id: 'x' }, { id: 'y' }] }],
    })
    expect(parsed.boards[0]?.columns.map((c) => c.id)).toEqual(['x', 'y'])
  })

  it('falls back to the id when a name is missing', () => {
    const parsed = parseBoards({ boards: [{ id: 'work', columns: [{ id: 'now' }] }] })
    expect(parsed.boards[0]?.name).toBe('work')
    expect(parsed.boards[0]?.columns[0]?.name).toBe('now')
  })

  it('rejects an id with a slash, which would end up in a path', () => {
    expect(parseBoards({ boards: [{ id: '../evil', columns: [{ id: 'x' }] }] })).toEqual(DEFAULT_BOARDS)
  })

  it('accepts non-Latin ids', () => {
    const parsed = parseBoards({ boards: [{ id: 'работа', columns: [{ id: 'делать' }] }] })
    expect(parsed.boards[0]?.id).toBe('работа')
  })
})

describe('placing a card in a column', () => {
  const columns = [
    { id: 'todo', name: 'To do' },
    { id: 'done', name: 'Done' },
  ]

  it('uses the status when it names a real column', () => {
    expect(columnOf('done', columns)).toBe('done')
  })

  it('falls back to the first column for a status nobody recognises', () => {
    // A card that cannot be seen cannot be fixed, so it must not vanish.
    expect(columnOf('in-limbo', columns)).toBe('todo')
    expect(columnOf(null, columns)).toBe('todo')
  })
})

describe('column ids from typed names', () => {
  it('slugs a name', () => {
    expect(columnId('In Review', [])).toBe('in-review')
  })

  it('keeps non-Latin names instead of destroying them', () => {
    expect(columnId('Делать', [])).toBe('делать')
  })

  it('never collides with an existing column', () => {
    const existing = [{ id: 'done', name: 'Done' }]
    expect(columnId('Done', existing)).toBe('done-2')
  })

  it('has something to fall back on when the name is all punctuation', () => {
    expect(columnId('!!!', [])).toBe('column')
  })
})
