import type { Row } from '../tree-rows'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { extensionOf, fileKind } from '@shared/file-kind'
import type { FileNode } from '@shared/vault'

const INDENT = 13

/** Where a folder's guide runs, from the row's left: its chevron's centre (6px padding + half of 14px). */
const GUIDE_X = 13

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

export function TreeRow({
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
      {/* Indentation guides, as in Obsidian: one line per open folder above
          this row, under that folder's chevron. The rows are a flat virtual
          list, so each row draws its own piece and the pieces meet. */}
      {Array.from({ length: depth }, (_, level) => (
        <span key={level} className="tree__guide" style={{ left: level * INDENT + GUIDE_X }} aria-hidden />
      ))}
      <span className={`tree__chevron${isFolder ? '' : ' is-hidden'}${isOpen ? ' is-open' : ''}`}>{isFolder ? '›' : ''}</span>
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
        <span className="tree__name">{label}</span>
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
 * The icon for a node, by what it is.
 *
 * Notes, images and the other files get their own, so a json or a PDF does
 * not read as a note - the tree is the one place you see every kind side by side.
 */
const ICON_BY_EXTENSION: Readonly<Record<string, string>> = {
  ...Object.fromEntries(['json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'canvas'].map((e) => [e, 'file-braces'])),
  ...Object.fromEntries(['csv', 'tsv'].map((e) => [e, 'file-spreadsheet'])),
  ...Object.fromEntries(['sh', 'bash', 'zsh', 'fish'].map((e) => [e, 'file-terminal'])),
  ...Object.fromEntries(['txt', 'text', 'log'].map((e) => [e, 'scroll-text'])),
  ...Object.fromEntries(['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].map((e) => [e, 'file-archive'])),
  ...Object.fromEntries(['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].map((e) => [e, 'file-audio'])),
  ...Object.fromEntries(['mp4', 'mov', 'mkv', 'webm', 'avi'].map((e) => [e, 'file-video'])),
}

function iconFor(node: FileNode): string {
  if (node.kind === 'folder') return 'folder'
  const kind = fileKind(node.name)
  if (kind === 'note') return 'file-text'
  if (kind === 'image') return 'image'
  if (kind === 'pdf') return 'file-scan'
  return ICON_BY_EXTENSION[extensionOf(node.name)] ?? (kind === 'code' ? 'file-code' : 'file')
}
