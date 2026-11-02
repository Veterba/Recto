import { useMemo, useState } from 'react'
import type { FileNode } from '@shared/vault'
import { registerView } from '../view-registry'
import { commands } from '../commands'
import type { SectionId } from '../sections'
import { fuzzyFilter, type MatchRange } from '../../ui/fuzzy'
import { pickerKeyDown, usePicker, useScrollSelected } from '../../ui/picker'
import { Icon } from '../../ui/Icon'
import { Highlight } from './CommandPalette'
import { noteEntries } from '../../features/file-tree'
import { boardMade, createBoard, isTaskPath, useBoards } from '../../features/boards'

/**
 * The page a tab's + opens: find something to show here, or make a new one -
 * a note in Data, a board in Tasks, the same as each section's own sidebar.
 *
 * One field does both. Empty, it lists "New note" and the notes edited last
 * (or "New board" and the boards); typed into, it lists what matches, with
 * "Create “…”" on top when nothing has that name yet (names are unique in
 * the vault). Whatever is picked opens in this tab, in place, so ← comes back
 * here.
 */

type Shell = {
  /** The section the page is in: it renders only while that section is shown. */
  section: () => SectionId
  roots: () => readonly FileNode[]
  openFile: (path: string) => void
  openBoard: (path: string) => void
  /** Null when made, or why not. */
  createNamed: (parent: string, name: string) => Promise<string | null>
}

type Item = { path: string; name: string; folder: string }
type Row = { kind: 'new' } | { kind: 'create'; name: string } | { kind: 'item'; item: Item; ranges: readonly MatchRange[] }

const RECENT = 8

/** The notes Data shows: not boards, their cards or Recto's own files (chats, the README). */
function notes(roots: readonly FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of roots) {
    if (node.kind === 'folder') notes(node.children ?? [], out)
    else if (node.name.toLowerCase().endsWith('.md') && !isTaskPath(node.path)) out.push(node)
  }
  return out
}

const itemOf = (node: FileNode): Item => {
  const at = node.path.lastIndexOf('/')
  return { path: node.path, name: node.name.replace(/\.md$/i, ''), folder: at === -1 ? '' : node.path.slice(0, at) }
}

function NewTab({ shell }: { shell: Shell }): React.ReactElement {
  const { query, setQuery, cursor, setCursor, inputRef, listRef } = usePicker(true)
  const [error, setError] = useState<string | null>(null)
  const boardMode = shell.section() === 'tasks'
  const roots = shell.roots()
  const boards = useBoards()

  // Everything that can be opened here, the latest first for notes.
  const items = useMemo(
    (): Item[] =>
      boardMode
        ? boards.map((b) => ({ path: b.path, name: b.name, folder: '' })).sort((a, b) => a.name.localeCompare(b.name))
        : notes(roots)
            .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
            .map(itemOf),
    [boardMode, boards, roots],
  )
  // Names a new one may not take: every note's in the vault, or every board's.
  const taken = useMemo(
    () => new Set((boardMode ? boards.map((b) => b.name) : noteEntries(roots).map((e) => e.name)).map((n) => n.toLowerCase())),
    [boardMode, boards, roots],
  )

  const rows = useMemo((): Row[] => {
    const typed = query.trim()
    if (typed === '') return [{ kind: 'new' }, ...items.slice(0, boardMode ? items.length : RECENT).map((item): Row => ({ kind: 'item', item, ranges: [] }))]
    const hits = fuzzyFilter(typed, items, (i) => i.name)
      .slice(0, 30)
      .map((hit): Row => ({ kind: 'item', item: hit.item, ranges: hit.match.ranges }))
    return taken.has(typed.toLowerCase()) || typed.includes('/') ? hits : [{ kind: 'create', name: typed }, ...hits]
  }, [query, items, taken, boardMode])

  useScrollSelected(listRef, cursor, rows)

  const make = async (name: string): Promise<void> => {
    if (!boardMode) {
      setError(await shell.createNamed('', name))
      return
    }
    const created = await createBoard(name)
    if (!created.ok) {
      setError('exists' in created ? `There is already a board named “${name}”.` : created.error)
      return
    }
    boardMade(created.path)
    shell.openBoard(created.path)
  }

  const pick = (index: number): void => {
    const row = rows[index]
    if (row === undefined) return
    if (row.kind === 'item') (boardMode ? shell.openBoard : shell.openFile)(row.item.path)
    else if (row.kind === 'create') void make(row.name)
    // A board needs its name first: the field asks for it.
    else if (boardMode) inputRef.current?.focus()
    else void commands.run('vault:new-note')
  }

  const firstItem = rows.findIndex((r) => r.kind === 'item')
  const typed = query.trim() !== ''
  const what = boardMode ? 'board' : 'note'

  return (
    <div className="new-tab">
      <div className="new-tab__column">
        <h2 className="new-tab__title">New tab</h2>
        <label className="new-tab__field">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            className="new-tab__input"
            placeholder={`Open a ${what}, or type a name for a new one…`}
            spellCheck={false}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value)
              setError(null)
            }}
            onKeyDown={(ev) => {
              // ⌘↵: make one with the typed name, whatever matches.
              if (ev.key === 'Enter' && ev.metaKey) {
                ev.preventDefault()
                const at = rows.findIndex((r) => r.kind === 'create')
                if (at !== -1) pick(at)
                return
              }
              pickerKeyDown(ev, { count: rows.length, cursor, setCursor, pick, close: () => setQuery('') })
            }}
          />
        </label>
        {error !== null && <p className="new-tab__error">{error}</p>}

        <ul className="new-tab__list" ref={listRef} role="listbox" aria-label={boardMode ? 'Boards' : 'Notes'}>
          {rows.map((row, i) => (
            <li key={row.kind === 'item' ? row.item.path : row.kind} role="presentation">
              {i === firstItem && <p className="new-tab__heading">{boardMode ? 'Boards' : typed ? 'Notes' : 'Edited lately'}</p>}
              <div
                role="option"
                aria-selected={i === cursor}
                className={`new-tab__row${i === cursor ? ' is-active' : ''}${row.kind === 'item' ? '' : ' is-action'}`}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  pick(i)
                }}
              >
                <Icon name={row.kind === 'item' ? (boardMode ? 'square-kanban' : 'file-text') : boardMode ? 'plus' : 'file-plus'} size={15} />
                {row.kind === 'item' ? (
                  <>
                    <span className="new-tab__name">
                      <Highlight text={row.item.name} ranges={row.ranges} />
                    </span>
                    {row.item.folder !== '' && <span className="new-tab__folder">{row.item.folder}</span>}
                  </>
                ) : (
                  <span className="new-tab__name">
                    {row.kind === 'create' ? `Create “${row.name}”` : boardMode ? 'New board: type its name above' : 'New note'}
                  </span>
                )}
                {row.kind === 'create' && <kbd className="new-tab__key">⌘↵</kbd>}
                {row.kind === 'new' && !boardMode && <kbd className="new-tab__key">{commands.label('vault:new-note') ?? ''}</kbd>}
              </div>
            </li>
          ))}
          {typed && firstItem === -1 && <li role="presentation" className="new-tab__none">{`No ${what} by that name yet.`}</li>}
          {!typed && items.length === 0 && <li role="presentation" className="new-tab__none">{`No ${what}s in this vault yet.`}</li>}
        </ul>
      </div>
    </div>
  )
}

export function registerNewTabView(shell: Shell): () => void {
  return registerView({
    type: 'new-tab',
    title: 'New tab',
    icon: 'plus',
    render: () => <NewTab shell={shell} />,
  })
}
