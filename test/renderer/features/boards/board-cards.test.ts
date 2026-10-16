// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import type { BoardCardInfo } from '../../../../src/shared/index-results'
import { setCardField, toggleCheck } from '../../../../src/shared/card-fields'
import { useBoardCards } from '../../../../src/renderer/features/boards/hooks/use-board-cards'
import type { Board } from '../../../../src/renderer/features/boards/boards'

/**
 * The board's writes are shown first and written second: these check that a
 * change is on screen before the file is, that a failed write is undone with
 * a notice, that a second Enter cannot make a second card, and that a card's
 * title is its file name.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const board: Board = {
  id: 'launch',
  name: 'Launch',
  columns: [
    { id: 'todo', name: 'To do' },
    { id: 'done', name: 'Done' },
  ],
}

const row = (title: string, over: Partial<BoardCardInfo> = {}): BoardCardInfo => ({
  path: `tasks/${title}.md`,
  title,
  description: '',
  status: 'todo',
  order: 1,
  start: null,
  due: null,
  completed: null,
  priority: null,
  tags: null,
  checklist: { done: 0, total: 1 },
  links: 0,
  ...over,
})

type Deferred = { resolve: (value: { ok: boolean; error?: string }) => void }

/** A vault in memory, and an index that never catches up unless told to. */
let files: Map<string, string>
let rows: BoardCardInfo[]
let calls: { channel: string; args: unknown[] }[]
/** When set, writes wait here instead of answering at once. */
let pendingWrites: Deferred[] | null
let failWrites: boolean
let failRename: boolean

beforeEach(() => {
  files = new Map([['tasks/Ship it.md', '---\nboard: launch\nstatus: todo\norder: 1\n---\n\n- [ ] Pack\n']])
  rows = [row('Ship it')]
  calls = []
  pendingWrites = null
  failWrites = false
  failRename = false
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    calls.push({ channel, args })
    switch (channel) {
      case IPC.indexBoard:
        return rows
      case IPC.fsRead: {
        const content = files.get(args[0] as string)
        return content === undefined ? { ok: false, error: 'missing' } : { ok: true, content }
      }
      case IPC.fsWrite: {
        const write = (): { ok: boolean; error?: string } => {
          if (failWrites) return { ok: false, error: 'Disk full.' }
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
        return { ok: true, path: to, rewrittenLinks: 0, rewrittenFiles: 0 }
      }
      case IPC.indexResolveLink:
        return [...files.keys()].find((p) => p.endsWith(`/${args[0]}.md`)) ?? null
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
    out.current = useBoardCards(board)
    return null
  }
  const el = document.createElement('div')
  root = createRoot(el)
  await act(async () => root!.render(createElement(Probe)))
  await act(async () => undefined)
  return out
}

const card = (hook: { current: ReturnType<typeof useBoardCards> }, title: string) => hook.current.cards?.find((c) => c.title === title)

describe('optimistic board writes', () => {
  it('shows a priority change before the file is written, and keeps it while the index lags', async () => {
    const hook = await mount()
    pendingWrites = []
    let done: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      done = hook.current.editCard('tasks/Ship it.md', (t) => setCardField(t, 'priority', 'high'))
    })
    // Read, shown - and the write still waiting.
    expect(pendingWrites).toHaveLength(1)
    expect(card(hook, 'Ship it')?.level).toBe('high')
    expect(files.get('tasks/Ship it.md')).not.toContain('priority')

    await act(async () => {
      pendingWrites![0]!.resolve({ ok: true })
      await done
    })
    expect(files.get('tasks/Ship it.md')).toContain('priority: high')
    // A reload from an index that has not seen the write yet does not snap it back.
    await act(async () => hook.current.reload())
    expect(card(hook, 'Ship it')?.level).toBe('high')
  })

  it('ticks a checklist item on the card at once', async () => {
    const hook = await mount()
    await act(async () => {
      await hook.current.editCard('tasks/Ship it.md', (t) => toggleCheck(t, 0))
    })
    expect(card(hook, 'Ship it')?.checklist).toEqual({ done: 1, total: 1 })
  })

  it('undoes a change whose write failed, and says so', async () => {
    const hook = await mount()
    failWrites = true
    let ok = true
    await act(async () => {
      ok = await hook.current.editCard('tasks/Ship it.md', (t) => setCardField(t, 'due', '2026-10-20'))
    })
    expect(ok).toBe(false)
    expect(card(hook, 'Ship it')?.span).toBeNull()
    expect(hook.current.notice).toMatch(/Couldn't save the card.*Disk full/)
  })

  it('moves a card to Done at once, with completed, and back when the write fails', async () => {
    const hook = await mount()
    failWrites = true
    pendingWrites = []
    await act(async () => {
      void hook.current.move('tasks/Ship it.md', { column: 'done', index: 0 })
    })
    expect(card(hook, 'Ship it')?.column).toBe('done')
    expect(card(hook, 'Ship it')?.completedDay).not.toBeNull()
    await act(async () => pendingWrites![0]!.resolve({ ok: false }))
    expect(card(hook, 'Ship it')?.column).toBe('todo')
    expect(hook.current.notice).not.toBeNull()
  })
})

describe('adding a card', () => {
  it('is on the board before its note is written, and the note has no H1', async () => {
    const hook = await mount()
    pendingWrites = []
    let result: Awaited<ReturnType<typeof hook.current.addCard>> | null = null
    await act(async () => {
      result = await hook.current.addCard('todo', 'Write notes')
    })
    expect(result).toEqual({ ok: true, path: 'tasks/Write notes.md' })
    expect(card(hook, 'Write notes')?.column).toBe('todo')
    await act(async () => pendingWrites![0]!.resolve({ ok: true }))
    const text = files.get('tasks/Write notes.md')!
    expect(text).toMatch(/^---\nboard: launch\nstatus: todo\norder: 2\n---\n\n?$/)
    expect(text).not.toMatch(/^# /m)
  })

  it('makes one card when Enter comes twice before the first write is done', async () => {
    const hook = await mount()
    pendingWrites = []
    const results: unknown[] = []
    await act(async () => {
      results.push(await hook.current.addCard('todo', 'Twice'))
      results.push(await hook.current.addCard('todo', 'Twice'))
    })
    expect(results[0]).toMatchObject({ ok: true })
    expect(results[1]).toMatchObject({ ok: false })
    expect(calls.filter((c) => c.channel === IPC.fsCreate)).toHaveLength(1)
    expect(hook.current.cards?.filter((c) => c.title === 'Twice')).toHaveLength(1)
    await act(async () => pendingWrites![0]!.resolve({ ok: true }))
  })

  it('refuses a name that is already a note, and makes nothing', async () => {
    files.set('Notes/Groceries.md', '# Groceries\n')
    const hook = await mount()
    let result: unknown = null
    await act(async () => {
      result = await hook.current.addCard('todo', 'Groceries')
    })
    expect(result).toEqual({ ok: false, exists: 'Notes/Groceries.md' })
    expect(calls.some((c) => c.channel === IPC.fsCreate)).toBe(false)
  })

  it('takes the card off again when its note cannot be written', async () => {
    const hook = await mount()
    failWrites = true
    await act(async () => {
      await hook.current.addCard('todo', 'Doomed')
    })
    await act(async () => undefined)
    expect(card(hook, 'Doomed')).toBeUndefined()
    expect(files.has('tasks/Doomed.md')).toBe(false)
    expect(hook.current.notice).toMatch(/Couldn't create the card/)
  })
})

describe('the title is the file name', () => {
  it('renaming the title renames the note, shown at once', async () => {
    const hook = await mount()
    let next: string | null = null
    await act(async () => {
      next = await hook.current.renameCard('tasks/Ship it.md', 'Ship it today')
    })
    expect(next).toBe('tasks/Ship it today.md')
    expect(files.has('tasks/Ship it today.md')).toBe(true)
    expect(card(hook, 'Ship it today')?.path).toBe('tasks/Ship it today.md')
    // The index still lists the old path for a moment; it is not shown twice.
    await act(async () => hook.current.reload())
    expect(hook.current.cards?.map((c) => c.title)).toEqual(['Ship it today'])
  })

  it('a rename that fails puts the old name back and says why', async () => {
    const hook = await mount()
    failRename = true
    await act(async () => {
      await hook.current.renameCard('tasks/Ship it.md', 'Taken')
    })
    expect(card(hook, 'Ship it')?.path).toBe('tasks/Ship it.md')
    expect(card(hook, 'Taken')).toBeUndefined()
    expect(hook.current.notice).toMatch(/already exists/)
  })
})
