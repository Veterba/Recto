import { useEffect, useMemo, useState } from 'react'
import { serializeCanvas, parseCanvas } from '@shared/canvas'
import { IPC } from '@shared/ipc'
import type { FileNode } from '@shared/vault'
import { CANVAS_FOLDER, isStrayCanvas } from '@shared/recto-paths'
import { api } from '../../../app/api'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { fuzzyMatch } from '../../../ui/fuzzy'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { NameWarning } from '../../../ui/NameWarning'

/**
 * The Canvas section's sidebar: every canvas in the vault, the one changed
 * last first, filtered by the sidebar's search box - and "New canvas", made
 * in Recto/Canvas (recto-paths.ts), under the same name rules as a note.
 * Canvases found anywhere else are offered a move there, never moved unasked.
 * Renamed, copied and archived here as a note is in Data.
 */

/** A failed copy (clipboard permission refused) is not worth a dialog. */
const copy = (text: string): void => void navigator.clipboard.writeText(text).catch(() => {})

type Entry = { path: string; name: string; folder: string; mtime: number }

function canvases(roots: readonly FileNode[], out: Entry[] = []): Entry[] {
  for (const node of roots) {
    if (node.kind === 'folder') canvases(node.children ?? [], out)
    else if (node.name.toLowerCase().endsWith('.canvas')) {
      const at = node.path.lastIndexOf('/')
      out.push({
        path: node.path,
        name: node.name.replace(/\.canvas$/i, ''),
        folder: at === -1 ? '' : node.path.slice(0, at),
        mtime: node.mtime ?? 0,
      })
    }
  }
  return out
}

/** An empty canvas, as Obsidian writes one. */
const EMPTY = serializeCanvas(parseCanvas(''))

/** Make a canvas named `name` in `folder`: its path, or why not. */
export async function createCanvas(folder: string, name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const bare = name.trim().replace(/\.canvas$/i, '')
  if (bare === '') return { ok: false, error: 'A canvas needs a name.' }
  const made = await api.invoke(IPC.fsCreate, folder, `${bare}.canvas`, 'file', 'refuse')
  if (!made.ok) return made
  const written = await api.invoke(IPC.fsWrite, made.path, EMPTY)
  return written.ok ? made : { ok: false, error: written.error ?? 'The canvas could not be written.' }
}

type Props = {
  roots: readonly FileNode[]
  active: string | null
  query: string
  /** Where "New canvas" makes one: the folder of what you have open. */
  folder: string
  onOpen: (path: string) => void
  /** Opened from elsewhere (the empty page): start naming a new one. */
  adding: boolean
  setAdding: (adding: boolean) => void
  /** For "Copy full path". */
  vaultPath: string
  /** A canvas was renamed: its tabs follow. */
  onRenamed: (from: string, to: string) => void
  /** A canvas was renamed or archived: the tree is read again. */
  onChanged: () => void
}

export function CanvasList({
  roots,
  active,
  query,
  folder,
  onOpen,
  adding,
  setAdding,
  vaultPath,
  onRenamed,
  onChanged,
}: Props): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  /** The name being typed for a new or renamed canvas, for what to know about it. */
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [renaming, adding])
  const [confirming, setConfirming] = useState<Entry | null>(null)
  const [moving, setMoving] = useState(false)
  const contextMenu = useContextMenu<Entry>()
  const all = useMemo(() => canvases(roots).sort((a, b) => b.mtime - a.mtime), [roots])
  const trimmed = query.trim()
  const shown = trimmed === '' ? all : all.filter((c) => fuzzyMatch(trimmed, c.name) !== null)

  const add = async (name: string): Promise<void> => {
    setAdding(false)
    if (name.trim() === '') return
    const made = await createCanvas(folder, name)
    if (!made.ok) {
      setError(made.error)
      return
    }
    setError(null)
    // Listed at once, not when the watcher next reads the folder.
    onChanged()
    onOpen(made.path)
  }

  const rename = async (c: Entry, name: string): Promise<void> => {
    setRenaming(null)
    const bare = name.trim().replace(/\.canvas$/i, '')
    if (bare === '' || bare === c.name) return
    const result = await api.invoke(IPC.fsRename, c.path, `${bare}.canvas`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onRenamed(c.path, result.path)
    onChanged()
  }

  // Archived rather than destroyed, as a note is: recoverable in-app for a while, then the system trash.
  const archive = async (path: string): Promise<void> => {
    const result = await api.invoke(IPC.archiveAdd, path)
    if (!result.ok) setError(result.error)
    else {
      setError(null)
      onChanged()
    }
  }

  const strays = all.filter((c) => isStrayCanvas(c.path))
  /** Canvases outside Recto/Canvas, moved there: links to them and Recto's own data about them follow, as for any move. */
  const gather = async (): Promise<void> => {
    setMoving(true)
    const failed: string[] = []
    for (const c of strays) {
      const moved = await api.invoke(IPC.fsMove, c.path, CANVAS_FOLDER)
      if (moved.ok) onRenamed(c.path, moved.path)
      else failed.push(`${c.name}: ${moved.error}`)
    }
    setMoving(false)
    setError(failed.length === 0 ? null : `Not moved - ${failed.join('; ')}`)
    onChanged()
  }

  const menuFor = (c: Entry): MenuItem[] => [
    { kind: 'heading', label: 'This canvas' },
    { kind: 'item', label: 'Open', icon: 'scan', run: () => onOpen(c.path) },
    { kind: 'item', label: 'Rename', icon: 'pencil', shortcut: 'F2', run: () => setRenaming(c.path) },
    { kind: 'item', label: 'Copy relative path', icon: 'copy', run: () => copy(c.path) },
    {
      kind: 'item',
      label: 'Copy full path',
      icon: 'clipboard-copy',
      run: () => copy(vaultPath === '' ? c.path : `${vaultPath}/${c.path}`),
    },
    { kind: 'item', label: 'Reveal in Finder', icon: 'external-link', run: () => void api.invoke(IPC.fsReveal, c.path) },
    { kind: 'separator' },
    { kind: 'item', label: 'Move to archive', icon: 'trash', danger: true, run: () => setConfirming(c) },
  ]

  return (
    <div className="boards canvas-list">
      {strays.length > 0 && (
        <div className="boards__taken canvas-list__strays" role="status">
          <p className="sidebar__empty">
            {strays.length === 1 ? '1 canvas is' : `${strays.length} canvases are`} outside {CANVAS_FOLDER}, where Recto keeps canvases.
          </p>
          <button className="btn btn--sm" disabled={moving} onClick={() => void gather()}>
            {moving ? 'Moving…' : `Move ${strays.length === 1 ? 'it' : 'them'} there`}
          </button>
        </div>
      )}
      {shown.map((c) => (
        <div
          className={`boards__row${c.path === active ? ' is-active' : ''}`}
          key={c.path}
          onContextMenu={(event) => contextMenu.open(event, c)}
        >
          {renaming === c.path ? (
            <input
              className="boards__rename"
              defaultValue={c.name}
              aria-label="Canvas name"
              autoFocus
              onChange={(event) => setTyped(event.target.value === c.name ? '' : event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => void rename(c, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <>
              <button
                className="boards__name"
                title={c.path}
                onClick={() => onOpen(c.path)}
                onDoubleClick={() => setRenaming(c.path)}
                onKeyDown={(event) => {
                  if (event.key === 'F2') setRenaming(c.path)
                }}
              >
                <Icon name="scan" size={14} />
                <span className="boards__label">{c.name}</span>
                {c.folder !== '' && c.folder !== CANVAS_FOLDER && <span className="canvas-list__folder">{c.folder}</span>}
              </button>
              <Tip label="Move this canvas to the archive">
                <button className="boards__remove" aria-label={`Delete ${c.name}`} onClick={() => setConfirming(c)}>
                  <Icon name="x" size={12} />
                </button>
              </Tip>
            </>
          )}
        </div>
      ))}
      {renaming !== null && <NameWarning name={typed} />}
      {all.length === 0 && !adding && <p className="sidebar__empty">No canvases yet. A canvas is a .canvas file; Obsidian opens it too.</p>}
      {all.length > 0 && shown.length === 0 && <p className="sidebar__empty">No canvas matches “{trimmed}”.</p>}
      {error !== null && (
        <p className="sidebar__empty boards__error" role="alert">
          {error}
        </p>
      )}
      {adding ? (
        <>
          <input
            className="boards__rename"
            placeholder="Canvas name"
            aria-label="New canvas name"
            autoFocus
            onChange={(event) => setTyped(event.target.value)}
            onBlur={(event) => void add(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setAdding(false)
            }}
          />
          <NameWarning name={typed} />
        </>
      ) : (
        <button className="boards__add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          New canvas
        </button>
      )}
      {contextMenu.menu !== null && (
        <ContextMenu items={menuFor(contextMenu.menu.subject)} at={contextMenu.menu.at} onClose={contextMenu.close} />
      )}
      {confirming !== null && (
        <ConfirmDialog
          title="Delete canvas"
          body={
            <>
              <strong>{confirming.name}</strong> goes to the archive. Recoverable there, then it goes to the system trash. The notes on
              it stay where they are.
            </>
          }
          confirmLabel="Move to archive"
          onConfirm={() => {
            const target = confirming.path
            setConfirming(null)
            void archive(target)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
