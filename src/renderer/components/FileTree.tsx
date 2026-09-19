import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/ipc-contract'
import { api } from '../api'
import { treeRowHeight } from '../core/appearance'
import type { VaultTree } from '../core/file-tree-ops'
import { coerceOrder, moveWithin, orderChildren, placeInto, type TreeOrder } from '../core/tree-order'
import { ConfirmDialog } from './ConfirmDialog'
import { NotePreviewCard } from './NotePreviewCard'
import { ContextMenu, useContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import { RenameDialog } from './RenameDialog'
import { Tip } from './Tip'

/**
 * The file explorer.
 *
 * Virtualised: the vault is flattened to the rows that are actually visible
 * (collapsed folders contribute nothing) and only the window around the scroll
 * position is rendered. A vault of 10k notes renders ~30 rows.
 */

const OVERSCAN = 8
const INDENT = 13

type Row = { node: FileNode; depth: number }

function flatten(
  nodes: readonly FileNode[],
  expanded: ReadonlySet<string>,
  order: TreeOrder,
  parent = '',
  depth = 0,
  out: Row[] = [],
): Row[] {
  for (const node of orderChildren(nodes, order, parent)) {
    out.push({ node, depth })
    if (node.kind === 'folder' && expanded.has(node.path) && node.children) {
      flatten(node.children, expanded, order, node.path, depth + 1, out)
    }
  }
  return out
}

/** Where a dragged row would land: inside a folder, or between two rows. */
type DropHint = { path: string; place: 'before' | 'after' | 'into' }

/**
 * Which third of the row the pointer is in.
 *
 * A row is three targets, not one: its edges put the dragged thing above or
 * below, its middle puts it inside. A folder gets a generous middle, because
 * that is the older gesture and the one people arrive with; a file has no
 * inside, so it splits down the level into before and after.
 *
 * Read from the event rather than from what the last `dragover` decided - a
 * drop that trusts state can act on a stale answer, and the stale answer here
 * is "inside", which swallows the folder instead of moving it.
 */
function placeFor(node: FileNode, clientY: number, box: DOMRect): DropHint['place'] {
  const at = (clientY - box.top) / Math.max(1, box.height)
  if (node.kind !== 'folder') return at < 0.5 ? 'before' : 'after'
  return at < 0.25 ? 'before' : at > 0.75 ? 'after' : 'into'
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

type Props = {
  tree: VaultTree
  activePath: string | null
  expanded: Set<string>
  onToggleFolder: (path: string) => void
  onOpenFile: (path: string) => void
  onChanged: () => void
  /** Create inside a specific folder, from the context menu. */
  onCreateIn: (parent: string, kind: 'file' | 'folder') => void
  /** Absolute vault path, for "copy full path". */
  vaultPath: string
  /** The templates folder, which gets its own icon so it cannot pass for a normal one. */
  templateFolder: string
  /** Which model the preview's "Summarize" button asks. */
  aiModel: string
  /** Milliseconds the pointer rests on a note before its preview opens. */
  previewDelayMs: number
}

/*
 * How long the pointer must rest on a note before its preview opens is a
 * setting (Settings → Appearance → Sidebar), because the right wait depends on
 * how you use the sidebar. It defaults to two seconds: the sidebar is somewhere
 * the pointer passes through on its way to something else, and a short delay
 * turns every trip across it into a flicker of cards nobody asked for.
 */
/**
 * Once one preview is open, the next row's opens quickly - you are browsing
 * previews now, and waiting two seconds per row would make that unbearable.
 * The same rule macOS uses for tooltips.
 */
const PREVIEW_WARM_MS = 250
/** Grace for the trip from the row to the card, so crossing the gap does not close it. */
const PREVIEW_CLOSE_MS = 180

export function FileTree({
  tree,
  activePath,
  expanded,
  onToggleFolder,
  onOpenFile,
  onChanged,
  onCreateIn,
  vaultPath,
  templateFolder,
  aiModel,
  previewDelayMs,
}: Props): React.ReactElement {
  // Read every render rather than fixed at module load: the sidebar's text
  // size is a setting, and the virtualiser has to agree with the stylesheet
  // about how tall a row is or it scrolls to the wrong one.
  const ROW_HEIGHT = treeRowHeight()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Where the drag would land - a folder to go inside, or a row to sit above or below. */
  const [hint, setHint] = useState<DropHint | null>(null)
  /**
   * The order folders were arranged in by hand, per vault.
   *
   * The filesystem has none, so without this a dragged folder would spring back
   * to its alphabetical place the moment the tree refreshed.
   */
  const [order, setOrder] = useState<TreeOrder>({})
  useEffect(() => {
    void api.invoke('state:read', 'tree-order').then((raw) => setOrder(coerceOrder(raw)))
  }, [])
  const saveOrder = useCallback((next: TreeOrder) => {
    setOrder(next)
    void api.invoke('state:write', 'tree-order', next)
  }, [])
  /** "Renamed, and N links in M notes were updated" - with an undo. */
  const [rewrite, setRewrite] = useState<{ files: number; links: number; undoId: string } | null>(null)
  /** The node a delete is waiting on confirmation for. */
  const [confirming, setConfirming] = useState<FileNode | null>(null)
  /** The open preview card, and the row it is anchored to. */
  const [peek, setPeek] = useState<{ node: FileNode; anchor: { top: number; right: number; bottom: number } } | null>(
    null,
  )
  const peekTimer = useRef<number | undefined>(undefined)
  const peekOpen = useRef(false)
  peekOpen.current = peek !== null

  const cancelPeek = useCallback(() => {
    window.clearTimeout(peekTimer.current)
    setPeek(null)
  }, [])

  const delayRef = useRef(previewDelayMs)
  delayRef.current = previewDelayMs
  const hoverRow = useCallback((node: FileNode, element: HTMLElement) => {
    window.clearTimeout(peekTimer.current)
    // Notes only: a folder has no gist, and an image previews itself.
    if (node.kind !== 'file' || !node.name.toLowerCase().endsWith('.md')) {
      if (peekOpen.current) peekTimer.current = window.setTimeout(() => setPeek(null), PREVIEW_CLOSE_MS)
      return
    }
    const box = element.getBoundingClientRect()
    peekTimer.current = window.setTimeout(
      () => setPeek({ node, anchor: { top: box.top, right: box.right, bottom: box.bottom } }),
      peekOpen.current ? PREVIEW_WARM_MS : delayRef.current,
    )
  }, [])

  const leaveRow = useCallback(() => {
    window.clearTimeout(peekTimer.current)
    if (peekOpen.current) peekTimer.current = window.setTimeout(() => setPeek(null), PREVIEW_CLOSE_MS)
  }, [])

  // Anything that means "I am doing something now" puts the preview away:
  // a click, a key, the window losing focus. Scroll is handled on the tree.
  useEffect(() => {
    if (peek === null) return
    const close = (): void => cancelPeek()
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [peek, cancelPeek])

  useEffect(() => () => window.clearTimeout(peekTimer.current), [])

  const rows = useMemo(() => flatten(tree.roots, expanded, order), [tree.roots, expanded, order])
  const contextMenu = useContextMenu<FileNode>()

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => {
      // Clipboard permission can be refused; a failed copy is not worth a
      // dialog, and the path is visible on the row anyway.
    })
  }, [])

  /**
   * The right-click menu for one node.
   *
   * Only actions that actually work appear here. A menu is a promise about
   * what the app can do, and an entry that opens nothing is worse than no
   * entry at all.
   */
  const menuFor = useCallback(
    (node: FileNode): MenuItem[] => {
      const isFolder = node.kind === 'folder'
      const parent = isFolder ? node.path : node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')))
      const full = vaultPath === '' ? node.path : `${vaultPath}/${node.path}`

      return [
        { kind: 'heading', label: isFolder ? 'Inside this folder' : 'Alongside this note' },
        {
          kind: 'item',
          label: 'New note',
          icon: 'file-plus',
          run: () => onCreateIn(parent, 'file'),
        },
        {
          kind: 'item',
          label: 'New folder',
          icon: 'folder-plus',
          run: () => onCreateIn(parent, 'folder'),
        },
        { kind: 'separator' },
        { kind: 'heading', label: isFolder ? 'This folder' : 'This note' },
        { kind: 'item', label: 'Rename', icon: 'pencil', shortcut: 'F2', run: () => setRenaming(node.path) },
        {
          kind: 'item',
          label: 'Copy relative path',
          icon: 'copy',
          run: () => copy(node.path),
        },
        {
          kind: 'item',
          label: 'Copy full path',
          icon: 'clipboard-copy',
          run: () => copy(full),
        },
        {
          kind: 'item',
          label: 'Reveal in Finder',
          icon: 'external-link',
          run: () => void api.invoke('fs:reveal', node.path),
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Move to archive',
          icon: 'trash',
          danger: true,
          run: () => setConfirming(node),
        },
      ]
    },
    [vaultPath, onCreateIn, copy],
  )

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

  /**
   * Drop between two rows: rearrange, and move first if it came from elsewhere.
   *
   * Both halves of the gesture end here - dropping a folder above its sibling
   * is an arrangement, dropping it above a row in another folder is a move AND
   * an arrangement - so the two never disagree about where the thing ended up.
   */
  const dropBeside = useCallback(
    async (from: string, target: FileNode, place: 'before' | 'after') => {
      setHint(null)
      if (from === target.path) return
      const toParent = parentOf(target.path)
      const siblings = toParent === '' ? tree.roots : (tree.byPath.get(toParent)?.children ?? [])
      if (parentOf(from) === toParent) {
        saveOrder(moveWithin(siblings, order, toParent, nameOf(from), target.name, place))
        return
      }
      const result = await api.invoke('fs:move', from, toParent)
      if (!result.ok) {
        setError(result.error)
        return
      }
      saveOrder(placeInto(siblings, order, toParent, nameOf(result.path), target.name, place))
      setSelected(result.path)
      onChanged()
      if (result.undoId !== undefined && result.rewrittenLinks > 0) {
        setRewrite({ files: result.rewrittenFiles, links: result.rewrittenLinks, undoId: result.undoId })
      }
    },
    [order, saveOrder, tree, onChanged],
  )

  const drop = useCallback(
    async (from: string, toParent: string) => {
      setHint(null)
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
            setConfirming(row.node)
          }
          break
        default:
          break
      }
    },
    [rows, cursorIndex, expanded, renaming, activate, onToggleFolder],
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
        onScroll={(ev) => {
          setScrollTop(ev.currentTarget.scrollTop)
          // The card is anchored to a row that just moved.
          cancelPeek()
        }}
        onPointerDown={cancelPeek}
        onKeyDown={onKeyDown}
        onDragOver={(ev) => {
          ev.preventDefault()
          setHint({ path: '', place: 'into' })
        }}
        onDragLeave={() => setHint(null)}
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
                onContextMenu={(ev) => {
                  cancelPeek()
                  contextMenu.open(ev, row.node)
                }}
                onHover={(element) => hoverRow(row.node, element)}
                onLeave={leaveRow}
                isActive={row.node.path === activePath}
                isTemplateFolder={row.node.kind === 'folder' && row.node.path === templateFolder}
                isCursor={row.node.path === cursor}
                onActivate={() => activate(row)}
                onStartRename={() => setRenaming(row.node.path)}
                isDropTarget={hint?.place === 'into' && hint.path === row.node.path}
                dropLine={hint !== null && hint.path === row.node.path && hint.place !== 'into' ? hint.place : null}
                onDragStart={(ev) => {
                  cancelPeek()
                  ev.dataTransfer.setData('text/plain', row.node.path)
                  ev.dataTransfer.effectAllowed = 'move'
                }}
                onDragOverRow={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  ev.dataTransfer.dropEffect = 'move'
                  setHint({
                    path: row.node.path,
                    place: placeFor(row.node, ev.clientY, ev.currentTarget.getBoundingClientRect()),
                  })
                }}
                onDelete={() => setConfirming(row.node)}
                onDropRow={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  const from = ev.dataTransfer.getData('text/plain')
                  if (from === '') return
                  const place = placeFor(row.node, ev.clientY, ev.currentTarget.getBoundingClientRect())
                  if (place === 'into') {
                    void drop(from, row.node.kind === 'folder' ? row.node.path : parentOf(row.node.path))
                    return
                  }
                  void dropBeside(from, row.node, place)
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {peek !== null && renaming === null && contextMenu.menu === null && (
        <NotePreviewCard
          path={peek.node.path}
          anchor={peek.anchor}
          mtime={peek.node.mtime}
          model={aiModel}
          onOpen={(path) => {
            cancelPeek()
            onOpenFile(path)
          }}
          // Resting on the card keeps it; leaving it starts the same short
          // grace a row does, so card and row behave as one target.
          onPointerEnter={() => window.clearTimeout(peekTimer.current)}
          onPointerLeave={leaveRow}
        />
      )}

      {contextMenu.menu !== null && (
        <ContextMenu
          items={menuFor(contextMenu.menu.subject)}
          at={contextMenu.menu.at}
          onClose={contextMenu.close}
        />
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={confirming.kind === 'folder' ? 'Delete folder' : 'Delete note'}
          body={
            confirming.kind === 'folder' ? (
              <>
                <strong>{confirming.name}</strong> and everything inside it goes to the archive.
                Recoverable there, then it goes to the system trash.
              </>
            ) : (
              <>
                <strong>{confirming.name.replace(/\.md$/i, '')}</strong> goes to the archive.
                Recoverable there, then it goes to the system trash.
              </>
            )
          }
          confirmLabel="Move to archive"
          onConfirm={() => {
            const target = confirming.path
            setConfirming(null)
            void remove(target)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {renaming !== null && (
        <RenameDialog
          name={renaming.slice(renaming.lastIndexOf('/') + 1)}
          path={renaming}
          onCommit={(name) => void commitRename(renaming, name)}
          onCancel={() => setRenaming(null)}
        />
      )}
    </>
  )
}

type RowProps = {
  row: Row
  isTemplateFolder: boolean
  onHover: (element: HTMLElement) => void
  onLeave: () => void
  isOpen: boolean
  onContextMenu: (ev: React.MouseEvent) => void
  isActive: boolean
  isCursor: boolean
  onActivate: () => void
  onStartRename: () => void
  isDropTarget: boolean
  /** A line above or below the row, where the dragged thing would land. */
  dropLine: 'before' | 'after' | null
  onDelete: () => void
  onDragStart: (ev: React.DragEvent) => void
  onDragOverRow: (ev: React.DragEvent) => void
  onDropRow: (ev: React.DragEvent) => void
}

function TreeRow({
  row,
  isTemplateFolder,
  onHover,
  onLeave,
  isOpen,
  onContextMenu,
  isActive,
  isCursor,
  onActivate,
  onStartRename,
  isDropTarget,
  dropLine,
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
        dropLine === 'before' ? 'is-drop-above' : '',
        dropLine === 'after' ? 'is-drop-below' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: depth * INDENT + 6 }}
      role="treeitem"
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={isActive}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOverRow}
      onDrop={onDropRow}
      onClick={onActivate}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      onPointerEnter={(ev) => onHover(ev.currentTarget)}
      onPointerLeave={onLeave}
    >
      <span className={`tree__chevron${isFolder ? '' : ' is-hidden'}${isOpen ? ' is-open' : ''}`}>
        {isFolder ? '›' : ''}
      </span>
      {/* An icon per kind, so a folder and a note are distinguishable without
          reading the chevron - which is invisible on a file. */}
      <span className="tree__icon">
        <Icon name={isTemplateFolder ? 'layout-template' : iconFor(node)} size={14} />
      </span>

      <>
          {/* No `title` here. The browser's own tooltip showed the path after a
              second and sat on top of the preview card - two things answering
              one hover. The preview carries the folder; long names are
              truncated with an ellipsis, and the full name is in the card. */}
          <span className="tree__name">
            {label}
          </span>
          <Tip label="Move to archive" hint="Recoverable for 10 days">
            <button
              className="tree__delete"
              aria-label={`Delete ${node.name}`}
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => {
                ev.stopPropagation()
                onDelete()
              }}
            >
              <Icon name="x" size={13} />
            </button>
          </Tip>
        </>
    </div>
  )
}

/**
 * The icon for a node.
 *
 * Attachments get their own so an image does not read as a note - the tree is
 * the one place you see both kinds side by side.
 */
function iconFor(node: FileNode): string {
  if (node.kind === 'folder') return 'folder'
  const lower = node.name.toLowerCase()
  if (lower.endsWith('.md')) return 'file-text'
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(lower)) return 'image'
  if (/\.(json|ya?ml|toml|css|js|ts|tsx|py|sh)$/.test(lower)) return 'file-code'
  return 'file'
}
