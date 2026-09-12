import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/ipc-contract'
import { api } from '../api'
import type { VaultTree } from '../core/file-tree-ops'
import { Icon } from './Icon'

/**
 * The file explorer.
 *
 * Virtualised: the vault is flattened to the rows that are actually visible
 * (collapsed folders contribute nothing) and only the window around the scroll
 * position is rendered. A vault of 10k notes renders ~30 rows.
 */

const ROW_HEIGHT = 24
const OVERSCAN = 8
const INDENT = 13

type Row = { node: FileNode; depth: number }

function flatten(nodes: readonly FileNode[], expanded: ReadonlySet<string>, depth = 0, out: Row[] = []): Row[] {
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.path) && node.children) {
      flatten(node.children, expanded, depth + 1, out)
    }
  }
  return out
}

type Props = {
  tree: VaultTree
  activePath: string | null
  expanded: Set<string>
  onToggleFolder: (path: string) => void
  onOpenFile: (path: string) => void
  onChanged: () => void
}

export function FileTree({
  tree,
  activePath,
  expanded,
  onToggleFolder,
  onOpenFile,
  onChanged,
}: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Folder currently hovered as a drop target, or '' for the vault root. */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** "Renamed, and N links in M notes were updated" - with an undo. */
  const [rewrite, setRewrite] = useState<{ files: number; links: number; undoId: string } | null>(null)

  const rows = useMemo(() => flatten(tree.roots, expanded), [tree.roots, expanded])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = rows.slice(first, last)

  const cursor = selected ?? activePath
  const cursorIndex = rows.findIndex((r) => r.node.path === cursor)

  const activate = useCallback(
    (row: Row) => {
      setSelected(row.node.path)
      if (row.node.kind === 'folder') onToggleFolder(row.node.path)
      else onOpenFile(row.node.path)
    },
    [onToggleFolder, onOpenFile],
  )

  const commitRename = useCallback(
    async (path: string, name: string) => {
      setRenaming(null)
      const current = path.slice(path.lastIndexOf('/') + 1)
      if (name.trim() === '' || name === current) return
      const result = await api.invoke('fs:rename', path, name)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected(result.path)
      onChanged()
      // Renaming silently rewrote other notes. Tell the user, and offer undo.
      if (result.undoId !== undefined && result.rewrittenLinks > 0) {
        setRewrite({ files: result.rewrittenFiles, links: result.rewrittenLinks, undoId: result.undoId })
      }
    },
    [onChanged],
  )

  // Deleting archives rather than destroying: recoverable in-app for the
  // retention window, then it goes to the OS trash.
  const remove = useCallback(
    async (path: string) => {
      const result = await api.invoke('archive:add', path)
      if (!result.ok) setError(result.error)
      else onChanged()
    },
    [onChanged],
  )

  const drop = useCallback(
    async (from: string, toParent: string) => {
      setDropTarget(null)
      if (from === toParent) return
      // Dropping into the folder it already lives in is a no-op, not an error.
      const currentParent = from.slice(0, Math.max(0, from.lastIndexOf('/')))
      if (currentParent === toParent) return
      const result = await api.invoke('fs:move', from, toParent)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected(result.path)
      onChanged()
      if (result.undoId !== undefined && result.rewrittenLinks > 0) {
        setRewrite({ files: result.rewrittenFiles, links: result.rewrittenLinks, undoId: result.undoId })
      }
    },
    [onChanged],
  )

  // Keyboard navigation, scoped to the tree: arrows move and expand/collapse,
  // Enter opens, F2 renames, Backspace trashes.
  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if (renaming !== null) return
      const row = rows[cursorIndex]

      const move = (delta: number): void => {
        const next = rows[Math.min(rows.length - 1, Math.max(0, cursorIndex + delta))]
        if (next) setSelected(next.node.path)
      }

      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault()
          move(cursorIndex === -1 ? 0 : 1)
          break
        case 'ArrowUp':
          ev.preventDefault()
          move(-1)
          break
        case 'ArrowRight':
          if (row?.node.kind === 'folder' && !expanded.has(row.node.path)) {
            ev.preventDefault()
            onToggleFolder(row.node.path)
          }
          break
        case 'ArrowLeft':
          if (row?.node.kind === 'folder' && expanded.has(row.node.path)) {
            ev.preventDefault()
            onToggleFolder(row.node.path)
          }
          break
        case 'Enter':
          if (row) {
            ev.preventDefault()
            activate(row)
          }
          break
        case 'F2':
          if (row) {
            ev.preventDefault()
            setRenaming(row.node.path)
          }
          break
        case 'Backspace':
          if (row && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault()
            void remove(row.node.path)
          }
          break
        default:
          break
      }
    },
    [rows, cursorIndex, expanded, renaming, activate, onToggleFolder, remove],
  )

  // Keep the keyboard cursor on screen.
  useEffect(() => {
    if (cursorIndex < 0 || !scrollRef.current) return
    const top = cursorIndex * ROW_HEIGHT
    const element = scrollRef.current
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight
    }
  }, [cursorIndex])

  if (tree.roots.length === 0) {
    return (
      <p className="sidebar__empty">
        This vault is empty. Press <kbd>⌘N</kbd> to make your first note.
      </p>
    )
  }

  return (
    <>
      {error !== null && (
        <p className="tree__error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {rewrite !== null && (
        <p className="tree__notice" role="status">
          <span>
            Updated {rewrite.links} {rewrite.links === 1 ? 'link' : 'links'} in {rewrite.files}{' '}
            {rewrite.files === 1 ? 'note' : 'notes'}.
          </span>
          <button
            className="tree__undo"
            onClick={() => {
              const id = rewrite.undoId
              setRewrite(null)
              void api.invoke('links:undo-rename', id).then((res) => {
                if (!res.ok) setError(res.error ?? 'Could not undo.')
                onChanged()
              })
            }}
          >
            Undo
          </button>
          <button className="tree__undo" onClick={() => setRewrite(null)}>
            Dismiss
          </button>
        </p>
      )}
      <div
        className="tree"
        ref={scrollRef}
        tabIndex={0}
        role="tree"
        onScroll={(ev) => setScrollTop(ev.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        onDragOver={(ev) => {
          ev.preventDefault()
          setDropTarget('')
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(ev) => {
          // Empty space below the rows means "move to the vault root".
          ev.preventDefault()
          const from = ev.dataTransfer.getData('text/plain')
          if (from !== '') void drop(from, '')
        }}
      >
        {/* A spacer of the full height gives a real scrollbar while only the
            visible window is in the DOM. */}
        <div className="tree__sizer" style={{ height: rows.length * ROW_HEIGHT }}>
          <div className="tree__window" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
            {visible.map((row) => (
              <TreeRow
                key={row.node.path}
                row={row}
                isOpen={expanded.has(row.node.path)}
                isActive={row.node.path === activePath}
                isCursor={row.node.path === cursor}
                isRenaming={row.node.path === renaming}
                onActivate={() => activate(row)}
                onStartRename={() => setRenaming(row.node.path)}
                onCommitRename={(name) => void commitRename(row.node.path, name)}
                onCancelRename={() => setRenaming(null)}
                isDropTarget={dropTarget === row.node.path}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('text/plain', row.node.path)
                  ev.dataTransfer.effectAllowed = 'move'
                }}
                onDragOverRow={(ev) => {
                  ev.preventDefault()
                  ev.dataTransfer.dropEffect = 'move'
                  // Files are not containers: dropping on one targets its folder.
                  setDropTarget(
                    row.node.kind === 'folder'
                      ? row.node.path
                      : row.node.path.slice(0, Math.max(0, row.node.path.lastIndexOf('/'))),
                  )
                }}
                onDelete={() => void remove(row.node.path)}
                onDropRow={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  const from = ev.dataTransfer.getData('text/plain')
                  const target =
                    row.node.kind === 'folder'
                      ? row.node.path
                      : row.node.path.slice(0, Math.max(0, row.node.path.lastIndexOf('/')))
                  if (from !== '') void drop(from, target)
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

type RowProps = {
  row: Row
  isOpen: boolean
  isActive: boolean
  isCursor: boolean
  isRenaming: boolean
  onActivate: () => void
  onStartRename: () => void
  onCommitRename: (name: string) => void
  onCancelRename: () => void
  isDropTarget: boolean
  onDelete: () => void
  onDragStart: (ev: React.DragEvent) => void
  onDragOverRow: (ev: React.DragEvent) => void
  onDropRow: (ev: React.DragEvent) => void
}

function TreeRow({
  row,
  isOpen,
  isActive,
  isCursor,
  isRenaming,
  onActivate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  isDropTarget,
  onDelete,
  onDragStart,
  onDragOverRow,
  onDropRow,
}: RowProps): React.ReactElement {
  const { node, depth } = row
  const isFolder = node.kind === 'folder'
  const label = isFolder ? node.name : node.name.replace(/\.md$/, '')

  return (
    <div
      className={[
        'tree__row',
        isActive ? 'is-active' : '',
        isCursor && !isActive ? 'is-cursor' : '',
        isDropTarget ? 'is-drop' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: depth * INDENT + 6 }}
      role="treeitem"
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={isActive}
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onDragOver={onDragOverRow}
      onDrop={onDropRow}
      onClick={onActivate}
      onDoubleClick={onStartRename}
      title={node.path}
    >
      <span className={`tree__chevron${isFolder ? '' : ' is-hidden'}${isOpen ? ' is-open' : ''}`}>
        {isFolder ? '›' : ''}
      </span>

      {isRenaming ? (
        <RenameInput initial={node.name} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <>
          <span className="tree__name">{label}</span>
          <button
            className="tree__delete"
            aria-label={`Delete ${node.name}`}
            title="Move to archive"
            onMouseDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              onDelete()
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </>
      )}
    </div>
  )
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): React.ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.focus()
    // Select the stem, not the extension - renaming almost never means
    // renaming '.md'.
    const dot = initial.lastIndexOf('.')
    element.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])

  return (
    <input
      ref={ref}
      className="tree__rename"
      value={value}
      spellCheck={false}
      onChange={(ev) => setValue(ev.target.value)}
      onClick={(ev) => ev.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(ev) => {
        ev.stopPropagation()
        if (ev.key === 'Enter') onCommit(value)
        else if (ev.key === 'Escape') onCancel()
      }}
    />
  )
}
