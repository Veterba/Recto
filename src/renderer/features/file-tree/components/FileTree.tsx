import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/vault'
import { api } from '../../../app/api'
import { beginNativePaneDrag } from '../../../app/pane-drag'
import { treeRowHeight } from '../../../app/appearance'
import type { VaultTree } from '../file-tree-ops'
import { moveWithin, placeInto } from '../tree-order'
import { useTreeOrder } from '../hooks/use-tree-order'
import { treeMenu } from '../tree-menu'
import { useNotePeek } from '../hooks/use-note-peek'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { NotePreviewCard } from './NotePreviewCard'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { RenameDialog } from './RenameDialog'
import { IPC } from '@shared/ipc'
import { nameOf, parentOf } from '@shared/vault'
import { type DropHint, flatten, type Row, placeFor } from '../tree-rows'
import { TreeRow } from './TreeRow'

/**
 * The file explorer.
 *
 * Virtualised: the vault is flattened to the rows that are actually visible
 * (collapsed folders contribute nothing) and only the window around the scroll
 * position is rendered. A vault of 10k notes renders ~30 rows.
 */

const OVERSCAN = 8

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
  /** Milliseconds the pointer rests on a note before its preview opens. */
  previewDelayMs: number
  /** A note's preview card was clicked: pin it as a floating window. */
  onPinNote: (path: string, rect: DOMRect) => void
}

/*
 * How long the pointer must rest on a note before its preview opens is a
 * setting (Settings → Appearance → Sidebar), because the right wait depends on
 * how you use the sidebar. It defaults to two seconds: the sidebar is somewhere
 * the pointer passes through on its way to something else, and a short delay
 * turns every trip across it into a flicker of cards nobody asked for.
 */

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
  previewDelayMs,
  onPinNote,
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
  const { order, saveOrder } = useTreeOrder()
  /** "Renamed, and N links in M notes were updated" - with an undo. */
  const [rewrite, setRewrite] = useState<{ files: number; links: number; undoId: string } | null>(null)
  /** The node a delete is waiting on confirmation for. */
  const [confirming, setConfirming] = useState<FileNode | null>(null)
  const { peek, peekTimer, cancelPeek, hoverRow, leaveRow } = useNotePeek(previewDelayMs)

  const rows = useMemo(() => flatten(tree.roots, expanded, order), [tree.roots, expanded, order])
  const contextMenu = useContextMenu<FileNode>()

  const menuFor = useCallback(
    (node: FileNode): MenuItem[] => treeMenu(node, { vaultPath, onCreateIn, rename: setRenaming, archive: setConfirming }),
    [vaultPath, onCreateIn],
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
      const result = await api.invoke(IPC.fsRename, path, name)
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
      const result = await api.invoke(IPC.archiveAdd, path)
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
      const result = await api.invoke(IPC.fsMove, from, toParent)
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
      const result = await api.invoke(IPC.fsMove, from, toParent)
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
    // One column: the error, the notice, then the tree in what is left. Stacked
    // loose, the tree was the full height of the sidebar AND something above it,
    // so the sidebar scrolled too - a second scrollbar next to the tree's.
    <div className="tree__frame">
      {error !== null && (
        <p className="tree__error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {rewrite !== null && (
        <p className="tree__notice" role="status">
          <span>
            Updated {rewrite.links} {rewrite.links === 1 ? 'link' : 'links'} in {rewrite.files} {rewrite.files === 1 ? 'note' : 'notes'}.
          </span>
          <button
            className="tree__undo"
            onClick={() => {
              const id = rewrite.undoId
              setRewrite(null)
              void api.invoke(IPC.linksUndoRename, id).then((res) => {
                if (!res.ok) setError(res.error ?? 'Could not undo.')
                onChanged()
              })
            }}
          >
            Undo
          </button>
          <button className="tree__notice-close" aria-label="Dismiss" onClick={() => setRewrite(null)}>
            <Icon name="x" size={12} />
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
        onPointerDown={(ev) => {
          cancelPeek()
          /*
           * Take the keyboard when a row is clicked.
           *
           * Rows are divs, and clicking one moved focus nowhere - so the arrow
           * keys, Enter, F2 and the trash shortcut, all of which are handled
           * here, did nothing until you had tabbed into the tree. Clicking a
           * note hands focus on to its editor a moment later, which is what
           * you want from a note; clicking a folder leaves it here, where the
           * arrows are.
           */
          const target = ev.target as HTMLElement
          if (target.closest('input, textarea') === null) ev.currentTarget.focus()
        }}
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
                  // A file can also be dropped on a pane, to open it there.
                  if (row.node.kind === 'file') {
                    beginNativePaneDrag({ kind: 'path', path: row.node.path }, nameOf(row.node.path).replace(/\.md$/i, ''))
                  }
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
          onOpen={(path) => {
            cancelPeek()
            onOpenFile(path)
          }}
          onPin={(path, rect) => {
            cancelPeek()
            onPinNote(path, rect)
          }}
          // Resting on the card keeps it; leaving it starts the same short
          // grace a row does, so card and row behave as one target.
          onPointerEnter={() => window.clearTimeout(peekTimer.current)}
          onPointerLeave={leaveRow}
        />
      )}

      {contextMenu.menu !== null && (
        <ContextMenu items={menuFor(contextMenu.menu.subject)} at={contextMenu.menu.at} onClose={contextMenu.close} />
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={confirming.kind === 'folder' ? 'Delete folder' : 'Delete note'}
          body={
            confirming.kind === 'folder' ? (
              <>
                <strong>{confirming.name}</strong> and everything inside it goes to the archive. Recoverable there, then it goes to the
                system trash.
              </>
            ) : (
              <>
                <strong>{confirming.name.replace(/\.md$/i, '')}</strong> goes to the archive. Recoverable there, then it goes to the system
                trash.
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
    </div>
  )
}
