import type { Row } from '../tree-rows'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
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
