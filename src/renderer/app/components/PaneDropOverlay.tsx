import { useRef, useSyncExternalStore } from 'react'
import { EDGE, zonePreview, type Rect } from '../pane-drop'
import { paneDragSnapshot, subscribePaneDrag } from '../pane-drag'

/**
 * What a drag over the panes shows: the five zones of the pane under the
 * pointer, and the area the drop would give the new pane.
 *
 * The preview keeps its last position while it fades out, so it eases away
 * from where it was rather than collapsing to a corner. Nothing here takes the
 * pointer: hit-testing looks straight through it.
 */
export function PaneDropOverlay(): React.ReactElement | null {
  const session = useSyncExternalStore(subscribePaneDrag, paneDragSnapshot)
  const last = useRef<Rect | null>(null)
  const over = session?.over ?? null
  if (over !== null) last.current = zonePreview(over.rect, over.zone)
  if (session === null) last.current = null
  const preview = last.current

  return (
    <div className="pane-drop" aria-hidden="true">
      {over !== null && (
        <svg className="pane-drop__zones" style={box(over.rect)} viewBox="0 0 1 1" preserveAspectRatio="none">
          {/* The centre, and the diagonals that divide the four edge bands. */}
          <rect x={EDGE} y={EDGE} width={1 - 2 * EDGE} height={1 - 2 * EDGE} vectorEffect="non-scaling-stroke" />
          <path
            d={`M0 0L${EDGE} ${EDGE}M1 0L${1 - EDGE} ${EDGE}M0 1L${EDGE} ${1 - EDGE}M1 1L${1 - EDGE} ${1 - EDGE}`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {preview !== null && <div className={`pane-drop__preview${over !== null ? ' is-shown' : ''}`} style={box(preview)} />}
      {session !== null && !session.native && (
        <div
          className="pane-drop__label glass-surface"
          // Near the right edge of the window the label goes to the left of
          // the pointer, rather than off the edge.
          style={
            session.x > window.innerWidth - LABEL_ROOM
              ? { left: session.x - 14, top: session.y + 14, transform: 'translateX(-100%)' }
              : { left: session.x + 14, top: session.y + 14 }
          }
        >
          {session.label}
        </div>
      )}
    </div>
  )
}

/** The widest the label gets, plus its offset from the pointer. */
const LABEL_ROOM = 260

const box = (rect: Rect): React.CSSProperties => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
