// @vitest-environment jsdom
import { formatLink, linkVault, OBSIDIAN_DEFAULTS } from '../../../../src/shared/obsidian-links'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import type { BoardCardInfo } from '../../../../src/shared/index-results'
import { cardFields, setCardField, toggleCheck } from '../../../../src/shared/card-fields'
import { useBoardCards } from '../../../../src/renderer/features/boards/hooks/use-board-cards'

/**
 * The board hook on a vault in memory: a board note in the Obsidian Kanban
 * format and its cards' notes. A change is on screen before any file is; a
 * move rewrites only the board's lines (and `completed` on the card going in
 * or out of Done); a failed write is undone with a notice; the file changing
 * under a write gets the same change, not an overwrite; a second Enter cannot
 * make a second card; and a line of text becomes a note on request.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BOARD = 'Recto/Boards/Launch/Launch.md'
const boardText = [
  '---',
  '',
  'kanban-plugin: board',
  '',
  '---',
  '',
  '## To do',
  '',
  '- [ ] [[Ship it]]',
  '- [ ] Buy stamps',
  '    at the post office',
  '',
  '',
  '## Done',
  '',
  '**Complete**',
  '- [x] [[Old one]]',
  '',
  '',
  '',
  '',
  '%% kanban:settings',
  '```',
  '{"kanban-plugin":"board"}',
  '```',
  '%%',
].join('\n')

type Deferred = { resolve: (value: { ok: boolean; error?: string }) => void }

/** A vault in memory, and an index that knows only what `indexed` says. */
let files: Map<string, string>
let indexed: Set<string>
let calls: { channel: string; args: unknown[] }[]
/** When set, writes wait here instead of answering at once. */
let pendingWrites: Deferred[] | null
let failWrites: (path: string) => boolean
let failRename: boolean

/** What the index would say about a note: its fields, from its text. */
const rowOf = (path: string): BoardCardInfo => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  links: 0,
  ...cardFields(files.get(path) ?? ''),
})

beforeEach(() => {
  files = new Map([
    [BOARD, boardText],
    ['Recto/Boards/Launch/Ship it.md', '---\npriority: low\n---\n\n- [ ] Pack\n'],
    ['Recto/Boards/Launch/Old one.md', '---\ncompleted: 2026-10-01\n---\n'],
  ])
  indexed = new Set(['Recto/Boards/Launch/Ship it.md', 'Recto/Boards/Launch/Old one.md'])
  calls = []
  pendingWrites = null
  failWrites = () => false
  failRename = false
  /** Index rows taken when the index last "saw" each note, so it can lag behind the files. */
  const seen = new Map<string, BoardCardInfo>([...indexed].map((p) => [p, rowOf(p)]))
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    calls.push({ channel, args })
    switch (channel) {
      case IPC.indexCards: {
        const out: Record<string, BoardCardInfo | null> = {}
        for (const link of args[0] as string[]) {
          const path = `Recto/Boards/Launch/${link}.md`
          out[link] = indexed.has(path) ? (seen.get(path) ?? rowOf(path)) : null
        }
        return out
      }
      case IPC.fsRead: {
        const content = files.get(args[0] as string)
        return content === undefined ? { ok: false, error: 'missing' } : { ok: true, content }
      }
      case IPC.fsWrite: {
        const write = (): { ok: boolean; error?: string } => {
          if (failWrites(args[0] as string)) return { ok: false, error: 'Disk full.' }
          files.set(args[0] as string, args[1] as string)
          return { ok: true }
        }
        if (pendingWrites === null) return write()
        return new Promise((resolve) => pendingWrites!.push({ resolve: () => resolve(write()) }))
      }
      case IPC.fsCreate: {
        const path = `${args[0]}/${args[1]}`
        files.set(path, '')
        return { ok: true, path }
      }
      case IPC.fsRename: {
        if (failRename) return { ok: false, error: '"Taken" already exists here.' }
        const from = args[0] as string
        const to = `${from.slice(0, from.lastIndexOf('/') + 1)}${args[1]}`
        files.set(to, files.get(from)!)
        files.delete(from)
        // Main rewrites every link to it, the board's line among them.
        const oldName = from.slice(from.lastIndexOf('/') + 1).replace(/\.md$/, '')
        const newName = (args[1] as string).replace(/\.md$/, '')
        files.set(BOARD, files.get(BOARD)!.split(`[[${oldName}]]`).join(`[[${newName}]]`))
        indexed.delete(from)
        indexed.add(to)
        return { ok: true, path: to, rewrittenLinks: 1, rewrittenFiles: 1 }
      }
      case IPC.fsSameNamed: {
        const name = String(args[0]).toLowerCase()
        return [...files.keys()].filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === name)
      }
      case IPC.linksFormat:
        return formatLink(args[0] as string, args[1] as string, linkVault([...files.keys()].map((p) => ({ path: p, ctime: 0 }))), OBSIDIAN_DEFAULTS, args[2] as object)
      case IPC.boardsPlace:
        return []
      case IPC.indexResolveLink:
        return [...files.keys()].find((p) => p.toLowerCase().endsWith(`/${String(args[0]).toLowerCase()}.md`)) ?? null
      case IPC.fsTrash:
        files.delete(args[0] as string)
        return { ok: true }
      default:
        return null
    }
  }
  ;(window as unknown as { api: unknown }).api = { invoke, on: () => () => undefined }
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

/** Mount the hook and hand back a live view of what it returns. */
async function mount(): Promise<{ current: ReturnType<typeof useBoardCards> }> {
  const out = {} as { current: ReturnType<typeof useBoardCards> }
  function Probe(): null {
    out.current = useBoardCards(BOARD)
    return null
  }
  const el = document.createElement('div')
  root = createRoot(el)
  await act(async () => root!.render(createElement(Probe)))
  await act(async () => undefined)
  return out
}

const card = (hook: { current: ReturnType<typeof useBoardCards> }, title: string) => hook.current.cards?.find((c) => c.title === title)
const board = (): string => files.get(BOARD)!
const changedLines = (before: string, after: string): string[] => {
  const a = before.split('\n')
  return after.split('\n').filter((line, i) => a[i] !== line)
}

describe('reading a board note', () => {
  it('draws its lanes and cards: notes with their fields, a line of text as it is', async () => {
    const hook = await mount()
    expect(hook.current.board?.columns.map((c) => [c.name, c.done === true])).toEqual([
      ['To do', false],
      ['Done', true],
    ])
    expect(hook.current.cards?.map((c) => [c.title, c.column, c.light])).toEqual([
      ['Ship it', '0', false],
      ['Buy stamps', '0', true],
      ['Old one', '1', false],
    ])
    expect(card(hook, 'Ship it')?.level).toBe('low')
    expect(card(hook, 'Buy stamps')?.description).toBe('at the post office')
  })
})

describe('moving cards', () => {
  it('a move within a column swaps lines of the board and touches nothing else', async () => {
    const hook = await mount()
    const key = card(hook, 'Buy stamps')!.key
    await act(async () => hook.current.move(key, { column: '0', index: 0 }))
    expect(board()).toBe(boardText.replace('- [ ] [[Ship it]]\n- [ ] Buy stamps\n    at the post office', '- [ ] Buy stamps\n    at the post office\n- [ ] [[Ship it]]'))
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toBe('---\npriority: low\n---\n\n- [ ] Pack\n')
  })

  it('into Done: on screen first, then the line ticked and moved, and completed on the note', async () => {
    const hook = await mount()
    pendingWrites = []
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = hook.current.move('Recto/Boards/Launch/Ship it.md', { column: '1', index: 0 })
    })
    expect(card(hook, 'Ship it')?.column).toBe('1')
    expect(board()).toBe(boardText)
    await act(async () => {
      pendingWrites![0]!.resolve({ ok: true })
      await new Promise((r) => setTimeout(r, 0))
    })
    // One line out of To do, the same line ticked into Done; every other line as it was.
    expect(board().split('\n')).toHaveLength(boardText.split('\n').length)
    expect(board()).toContain('**Complete**\n- [x] [[Ship it]]\n- [x] [[Old one]]')
    expect(board()).not.toContain('- [ ] [[Ship it]]')
    await act(async () => {
      for (const w of pendingWrites!.splice(0)) w.resolve({ ok: true })
      await done
    })
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toMatch(/^completed: \d{4}-\d{2}-\d{2}$/m)
  })

  it('out of Done: unticked, and completed gone from the note', async () => {
    const hook = await mount()
    await act(async () => hook.current.move('Recto/Boards/Launch/Old one.md', { column: '0', index: 0 }))
    expect(board()).toContain('## To do\n\n- [ ] [[Old one]]\n- [ ] [[Ship it]]')
    expect(files.get('Recto/Boards/Launch/Old one.md')).not.toContain('completed')
  })

  it('a board write that fails is undone on screen and said', async () => {
    const hook = await mount()
    failWrites = (path) => path === BOARD
    await act(async () => hook.current.move('Recto/Boards/Launch/Ship it.md', { column: '1', index: 0 }))
    expect(card(hook, 'Ship it')?.column).toBe('0')
    expect(hook.current.notice).toMatch(/Couldn't save the board.*Disk full/)
    expect(files.get('Recto/Boards/Launch/Ship it.md')).not.toContain('completed')
  })

  it('when the board changed under it (Obsidian, sync), the same move is made to what is there now', async () => {
    const hook = await mount()
    files.set(BOARD, boardText.replace('- [ ] Buy stamps', '- [ ] Added in Obsidian\n- [ ] Buy stamps'))
    const key = card(hook, 'Buy stamps')!.key
    await act(async () => hook.current.move(key, { column: '1', index: 0 }))
    expect(board()).toContain('- [ ] [[Ship it]]\n- [ ] Added in Obsidian\n\n')
    expect(board()).toContain('**Complete**\n- [x] Buy stamps\n    at the post office\n- [x] [[Old one]]')
  })
})

describe('board writes in a queue', () => {
  it('a write after one that failed does not bring the failed change back', async () => {
    const hook = await mount()
    pendingWrites = []
    let fails = 1
    failWrites = (path) => path === BOARD && fails-- > 0
    let first: Promise<boolean> = Promise.resolve(true)
    let second: Promise<boolean> = Promise.resolve(true)
    // The second is made once the first is on screen, as a second gesture would be.
    await act(async () => {
      first = hook.current.editBoard((t) => t.replace('## To do', '## Backlog'))
    })
    await act(async () => {
      second = hook.current.editBoard((t) => t.replace('## Done', '## Shipped'))
    })
    await act(async () => {
      pendingWrites![0]!.resolve({ ok: true })
      await first
    })
    await act(async () => {
      pendingWrites![1]!.resolve({ ok: true })
      await second
    })
    expect(board()).toContain('## To do')
    expect(board()).not.toContain('## Backlog')
    expect(board()).toContain('## Shipped')
  })

  it('two edits to one card note close together both land', async () => {
    const hook = await mount()
    pendingWrites = []
    let a: Promise<boolean> = Promise.resolve(true)
    let b: Promise<boolean> = Promise.resolve(true)
    await act(async () => {
      a = hook.current.editCard('Recto/Boards/Launch/Ship it.md', (t) => setCardField(t, 'priority', 'high'))
      b = hook.current.editCard('Recto/Boards/Launch/Ship it.md', (t) => setCardField(t, 'due', '2026-11-01'))
    })
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        while (pendingWrites!.length === 0) await Promise.resolve()
        pendingWrites!.shift()!.resolve({ ok: true })
      })
    }
    await act(async () => {
      await Promise.all([a, b])
    })
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toContain('priority: high')
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toContain('due: 2026-11-01')
  })
})

describe('emptying a column', () => {
  it('moving its cards last first, each to the same slot, moves every text card and keeps their order', async () => {
    files.set(BOARD, boardText.replace('- [ ] Buy stamps\n    at the post office', '- [ ] One\n- [ ] Two\n- [ ] Three'))
    const hook = await mount()
    const from = hook.current.cards!.filter((c) => c.column === '0')
    const at = hook.current.cards!.filter((c) => c.column === '1').length
    // As the delete-column dialog does it (BoardView).
    for (const c of [...from].reverse()) await act(async () => hook.current.move(c.key, { column: '1', index: at }))
    expect(hook.current.cards!.filter((c) => c.column === '0')).toEqual([])
    expect(hook.current.cards!.filter((c) => c.column === '1').map((c) => c.title)).toEqual(['Old one', 'Ship it', 'One', 'Two', 'Three'])
  })
})

describe("a card's note", () => {
  it('shows a priority change before the file is written, and keeps it while the index lags', async () => {
    const hook = await mount()
    pendingWrites = []
    let done: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      done = hook.current.editCard('Recto/Boards/Launch/Ship it.md', (t) => setCardField(t, 'priority', 'high'))
    })
    expect(pendingWrites).toHaveLength(1)
    expect(card(hook, 'Ship it')?.level).toBe('high')
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toContain('priority: low')
    await act(async () => {
      pendingWrites![0]!.resolve({ ok: true })
      await done
    })
    expect(files.get('Recto/Boards/Launch/Ship it.md')).toContain('priority: high')
    // The index still says low; a reload does not snap it back.
    await act(async () => hook.current.reload())
    expect(card(hook, 'Ship it')?.level).toBe('high')
  })

  it('ticks a checklist item on the card at once', async () => {
    const hook = await mount()
    await act(async () => {
      await hook.current.editCard('Recto/Boards/Launch/Ship it.md', (t) => toggleCheck(t, 0))
    })
    expect(card(hook, 'Ship it')?.checklist).toEqual({ done: 1, total: 1 })
  })

  it('undoes a change whose write failed, and says so', async () => {
    const hook = await mount()
    failWrites = () => true
    let ok = true
    await act(async () => {
      ok = await hook.current.editCard('Recto/Boards/Launch/Ship it.md', (t) => setCardField(t, 'due', '2026-10-20'))
    })
    expect(ok).toBe(false)
    expect(card(hook, 'Ship it')?.span).toBeNull()
    expect(hook.current.notice).toMatch(/Couldn't save the card.*Disk full/)
  })
})

describe('adding a card', () => {
  it('makes the note in the board’s folder, empty, and its line at the top of the column', async () => {
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('0', 'Write notes')
    })
    expect(result).toEqual({ ok: true, path: 'Recto/Boards/Launch/Write notes.md' })
    expect(files.get('Recto/Boards/Launch/Write notes.md')).toBe('')
    expect(board()).toContain('## To do\n\n- [ ] [[Write notes]]\n- [ ] [[Ship it]]')
    expect(changedLines(boardText, board())[0]).toBe('- [ ] [[Write notes]]')
    // Shown before the index has read it.
    expect(card(hook, 'Write notes')).toMatchObject({ column: '0', path: 'Recto/Boards/Launch/Write notes.md', light: false })
  })

  it('makes one card when Enter comes twice before the first is done', async () => {
    const hook = await mount()
    const results: unknown[] = []
    await act(async () => {
      const first = hook.current.addCard('0', 'Twice')
      const second = hook.current.addCard('0', 'Twice')
      results.push(await first, await second)
    })
    expect(results[0]).toMatchObject({ ok: true })
    expect(results[1]).toMatchObject({ ok: false })
    expect(calls.filter((c) => c.channel === IPC.fsCreate)).toHaveLength(1)
    expect(board().match(/\[\[Twice\]\]/g)).toHaveLength(1)
  })

  it('a name another folder has is a choice, never a guess: nothing is made until a new card is asked for', async () => {
    files.set('Notes/Groceries.md', '# Groceries\n')
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('0', 'Groceries')
    })
    expect(result).toEqual({ ok: false, elsewhere: ['Notes/Groceries.md'] })
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
    expect(board()).toBe(boardText)
    // "Create a new one on this board": its own note, linked by its path - the name alone would not say which.
    await act(async () => {
      result = await hook.current.addCard('0', 'Groceries', true)
    })
    expect(result).toEqual({ ok: true, path: 'Recto/Boards/Launch/Groceries.md' })
    expect(board()).toContain('- [ ] [[Recto/Boards/Launch/Groceries]]')
    expect(files.get('Notes/Groceries.md')).toBe('# Groceries\n')
  })

  it('a name this board’s folder has: that note is offered, nothing is made', async () => {
    files.set('Recto/Boards/Launch/groceries.md', '')
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('0', 'Groceries', true)
    })
    expect(result).toEqual({ ok: false, here: 'Recto/Boards/Launch/groceries.md' })
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
  })

  it('takes the note away again when the board cannot be written', async () => {
    const hook = await mount()
    failWrites = (path) => path === BOARD
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('0', 'Doomed')
    })
    expect(result).toMatchObject({ ok: false })
    expect(files.has('Recto/Boards/Launch/Doomed.md')).toBe(false)
    expect(card(hook, 'Doomed')).toBeUndefined()
  })
})

describe('a line of text', () => {
  it('becomes a note in the board’s folder - its first line the name, the rest the body - and its line a link', async () => {
    const hook = await mount()
    const key = card(hook, 'Buy stamps')!.key
    let made: string | null = null
    await act(async () => {
      made = await hook.current.makeNote(key)
    })
    expect(made).toBe('Recto/Boards/Launch/Buy stamps.md')
    expect(files.get('Recto/Boards/Launch/Buy stamps.md')).toBe('at the post office\n')
    expect(board()).toBe(boardText.replace('- [ ] Buy stamps\n    at the post office', '- [ ] [[Buy stamps]]'))
    expect(card(hook, 'Buy stamps')).toMatchObject({ light: false, path: 'Recto/Boards/Launch/Buy stamps.md' })
  })

  it('is not made a note when the board’s folder has its name; the board is left alone', async () => {
    files.set('Recto/Boards/Launch/Buy stamps.md', '')
    const hook = await mount()
    await act(async () => {
      await hook.current.makeNote(card(hook, 'Buy stamps')!.key)
    })
    expect(hook.current.notice).toMatch(/already in this board’s folder/)
    expect(board()).toBe(boardText)
  })

  it('comes off the board, and only its lines go', async () => {
    const hook = await mount()
    await act(async () => {
      await hook.current.removeCard(card(hook, 'Buy stamps')!.key)
    })
    expect(board()).toBe(boardText.replace('- [ ] Buy stamps\n    at the post office\n', ''))
  })
})

describe('the title is the file name', () => {
  it('renaming the title renames the note, and the board reads its rewritten link', async () => {
    const hook = await mount()
    let next: string | null = null
    await act(async () => {
      next = await hook.current.renameCard('Recto/Boards/Launch/Ship it.md', 'Ship it today')
    })
    await act(async () => undefined)
    expect(next).toBe('Recto/Boards/Launch/Ship it today.md')
    expect(board()).toContain('- [ ] [[Ship it today]]')
    expect(card(hook, 'Ship it today')?.path).toBe('Recto/Boards/Launch/Ship it today.md')
    expect(hook.current.cards?.map((c) => c.title)).toEqual(['Ship it today', 'Buy stamps', 'Old one'])
  })

  it('a rename that fails keeps the old name and says why', async () => {
    const hook = await mount()
    failRename = true
    await act(async () => {
      await hook.current.renameCard('Recto/Boards/Launch/Ship it.md', 'Taken')
    })
    expect(card(hook, 'Ship it')?.path).toBe('Recto/Boards/Launch/Ship it.md')
    expect(hook.current.notice).toMatch(/already exists/)
  })
})

describe('a note that exists already', () => {
  it('goes on the board as a link, its file left where it is and nothing made', async () => {
    files.set('Notes/Groceries.md', '# Groceries\n')
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addExisting('0', 'Notes/Groceries.md')
    })
    expect(result).toEqual({ ok: true, path: 'Notes/Groceries.md' })
    expect(board()).toBe(boardText.replace('- [ ] [[Ship it]]', '- [ ] [[Groceries]]\n- [ ] [[Ship it]]'))
    expect(files.get('Notes/Groceries.md')).toBe('# Groceries\n')
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
    // A note outside Recto's folders is never placed.
    expect(calls.some((c) => c.channel === IPC.boardsPlace)).toBe(false)
  })

  it('is said, not added twice, when it is on this board already', async () => {
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addExisting('0', 'Recto/Boards/Launch/Ship it.md')
    })
    expect(result).toEqual({ ok: false, error: '“Ship it” is on this board already.' })
    expect(board()).toBe(boardText)
  })

  it('a card from Unsorted is placed after it goes on a board', async () => {
    files.set('Recto/Unsorted/Later.md', '')
    const hook = await mount()
    await act(async () => {
      await hook.current.addExisting('0', 'Recto/Unsorted/Later.md')
    })
    expect(calls.filter((c) => c.channel === IPC.boardsPlace).map((c) => c.args)).toEqual([[['Recto/Unsorted/Later.md'], [BOARD]]])
  })
})

describe('taking a card off a board', () => {
  it('asks main to place its file when it is one of Recto’s, and leaves an outside note alone', async () => {
    files.set(BOARD, boardText.replace('- [ ] Buy stamps', '- [ ] [[Basil]]\n- [ ] Buy stamps'))
    files.set('Garden/Basil.md', '')
    const hook = await mount()
    await act(async () => {
      await hook.current.removeCard(card(hook, 'Ship it')!.key)
    })
    await act(async () => {
      await hook.current.removeCard(card(hook, 'Basil')!.key)
    })
    expect(calls.filter((c) => c.channel === IPC.boardsPlace).map((c) => c.args[0])).toEqual([['Recto/Boards/Launch/Ship it.md']])
    expect(files.has('Garden/Basil.md')).toBe(true)
  })
})

describe('a name with “/”', () => {
  it('a new card is refused, not renamed to fit; nothing is made', async () => {
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('0', 'Basil/Soil')
    })
    expect(result).toEqual({ ok: false, error: 'File name cannot contain any of the following characters: \\ / :' })
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
    expect(board()).toBe(boardText)
  })

  it('a line of text is not made a note, and says why', async () => {
    files.set(BOARD, boardText.replace('- [ ] Buy stamps', '- [ ] Buy stamps/envelopes'))
    const hook = await mount()
    await act(async () => {
      await hook.current.makeNote(card(hook, 'Buy stamps/envelopes')!.key)
    })
    expect(hook.current.notice).toBe('Couldn\'t make the note: File name cannot contain any of the following characters: \\ / :.')
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
  })

  it('renaming a card is refused and it keeps its name', async () => {
    const hook = await mount()
    let next: string | null = 'unset'
    await act(async () => {
      next = await hook.current.renameCard('Recto/Boards/Launch/Ship it.md', 'Ship/it')
    })
    expect(next).toBeNull()
    expect(hook.current.notice).toBe('Couldn\'t rename the card: File name cannot contain any of the following characters: \\ / :.')
    expect(calls.some((c) => c.channel === IPC.fsRename)).toBe(false)
  })
})
