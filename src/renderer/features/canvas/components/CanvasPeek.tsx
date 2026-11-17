import { renderPeek } from '../../editor/components/MarkdownView'
import { Icon } from '../../../ui/Icon'

/**
 * A file opened from the canvas, beside it, as Notion's side peek: no tab of
 * its own, the canvas staying where it was. Links followed in it open in it
 * (`onOpen`); ↗ opens it as a page in the canvas's tab, ← there coming back.
 */
export function CanvasPeek({
  path,
  onOpen,
  onExpand,
  onClose,
}: {
  path: string
  onOpen: (path: string) => void
  onExpand: () => void
  onClose: () => void
}): React.ReactElement {
  return (
    <aside className="canvas-peek" aria-label="Side peek">
      <header className="canvas-peek__bar">
        <button className="canvas-peek__button" aria-label="Close side peek" title="Close side peek" onClick={onClose}>
          <Icon name="chevrons-right" size={16} />
        </button>
        <button className="canvas-peek__button" aria-label="Open as a page" title="Open as a page" onClick={onExpand}>
          <Icon name="maximize" size={14} />
        </button>
      </header>
      <div className="canvas-peek__body">
        <div className="canvas-peek__leaf">{renderPeek(path, { onOpenPath: onOpen, onRenamed: onOpen })}</div>
      </div>
    </aside>
  )
}
