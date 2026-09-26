import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { ALL_LINKS } from '../degree-bins'
import { Tip } from '../../../ui/Tip'
import { DEFAULT_LOOK } from '../look'
import { DEFAULT_LAYOUT } from '../layout'
import { DEFAULT_TUNABLES } from '../protocol'
import { type SectionId, SECTIONS, type GraphPanelProps } from '../graph-panel-sections'
import { useWheelPosition } from '../hooks/use-wheel-position'
import { SectionWheel } from './SectionWheel'
import { SectionBody } from './SectionBody'

/**
 * Editing the graph: a wheel of sections on the right edge, and beside it the
 * controls for whichever section the wheel has settled on.
 *
 * A wheel rather than a list of collapsible sections because the graph is the
 * thing being edited and should stay on screen: the wheel is a narrow strip at
 * the edge, and only one section's controls are ever out at a time, right
 * beside it. Scroll or drag the wheel, or click an item; when it comes to rest
 * the section opens. Every change applies live.
 */

// --- the wheel ------------------------------------------------------------------

// --- the sections ---------------------------------------------------------------

/** Put one section back as it was out of the box. */
function resetSection(id: SectionId, props: Omit<GraphPanelProps, 'onClose'>): void {
  const { look, onLook, onLayout, onTunables, onLinkRange } = props
  const d = DEFAULT_LOOK
  switch (id) {
    case 'layout':
      onLayout(DEFAULT_LAYOUT)
      break
    case 'links':
      onLook({ ...look, edge: d.edge })
      break
    case 'dots':
      onLook({ ...look, node: d.node })
      onLinkRange(ALL_LINKS)
      break
    case 'colour':
      onLook({ ...look, dots: d.dots, links: d.links, background: d.background })
      break
    case 'labels':
      onLook({ ...look, label: d.label })
      break
    case 'forces':
      onTunables(DEFAULT_TUNABLES)
      break
  }
}

export function GraphPanel(props: GraphPanelProps): React.ReactElement {
  const [settled, setSettled] = useState<SectionId | null>(null)
  const [closing, setClosing] = useState(false)
  const { position, nudge, goTo } = useWheelPosition(SECTIONS.length, (index) => setSettled(SECTIONS[index]?.id ?? null))

  const close = useCallback(() => {
    setClosing(true)
    window.setTimeout(props.onClose, 240)
  }, [props.onClose])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [close])

  const section = SECTIONS.find((item) => item.id === settled)

  return (
    <div className={`gset${closing ? ' is-closing' : ''}`}>
      {section !== undefined && (
        <section
          key={section.id}
          className="gset__panel"
          aria-label={section.name}
          style={{ ['--hue' as string]: section.hue }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <header className="gset__head">
            <span className="gset__title">
              <span className="gset__dot" />
              {section.name}
            </span>
            <Tip label={`Reset ${section.name.toLowerCase()}`}>
              <button
                className="icon-btn"
                aria-label={`Reset ${section.name.toLowerCase()}`}
                onClick={() => resetSection(section.id, props)}
              >
                <Icon name="rotate-ccw" size={13} />
              </button>
            </Tip>
          </header>
          <div className="gset__body">
            <SectionBody id={section.id} {...props} />
          </div>
        </section>
      )}
      <SectionWheel position={position} settled={settled} onNudge={nudge} onPick={goTo} onClose={close} />
    </div>
  )
}
