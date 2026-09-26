import { type SectionId, SECTIONS } from '../graph-panel-sections'
import { useRef } from 'react'
import { Tip } from '../../../ui/Tip'
import { Icon } from '../../../ui/Icon'

/** Distance between items along the wheel, and the radius of the arc they sit on. */
const SPACING = 64

const RADIUS = 520

/** Where the items' right edges and the arc sit across the wheel, in px. */
const ITEM_EDGE = 150

const ARC_X = 166

export function SectionWheel({
  position,
  settled,
  onNudge,
  onPick,
  onClose,
}: {
  position: number
  settled: SectionId | null
  onNudge: (by: number) => void
  onPick: (index: number) => void
  onClose: () => void
}): React.ReactElement {
  const drag = useRef<{ y: number; moved: boolean } | null>(null)
  const height = SPACING * 7

  // The arc the items ride on, drawn a little to their right.
  const arc = Array.from({ length: 41 }, (_, i) => {
    const y = ((i - 20) / 20) * (height / 2)
    const x = RADIUS - Math.sqrt(Math.max(0, RADIUS * RADIUS - y * y))
    return `${i === 0 ? 'M' : 'L'}${(ARC_X + x).toFixed(1)} ${(height / 2 + y).toFixed(1)}`
  }).join(' ')

  return (
    <div
      className="gwheel"
      style={{ height }}
      onWheel={(event) => {
        event.stopPropagation()
        onNudge(event.deltaY / (event.deltaMode === 1 ? 3 : 90))
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        drag.current = { y: event.clientY, moved: false }
        const move = (moved: PointerEvent): void => {
          if (drag.current === null) return
          const dy = moved.clientY - drag.current.y
          if (Math.abs(dy) > 3) drag.current.moved = true
          drag.current.y = moved.clientY
          if (drag.current.moved) onNudge(-dy / SPACING)
        }
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          // A drag that ends between items still has to settle on one.
          if (drag.current?.moved === true) onNudge(0)
          setTimeout(() => {
            drag.current = null
          }, 0)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      role="listbox"
      aria-label="Graph settings"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') onPick(Math.round(position) + 1)
        if (event.key === 'ArrowUp') onPick(Math.round(position) - 1)
      }}
    >
      <svg className="gwheel__arc" width={220} height={height} aria-hidden="true">
        <path d={arc} />
      </svg>
      <Tip label="Close settings" hint="Esc">
        <button className="gwheel__handle" style={{ top: height / 2, left: ARC_X - 15 }} onClick={onClose} aria-label="Close settings" />
      </Tip>

      {SECTIONS.map((section, index) => {
        const offset = index - position
        const y = offset * SPACING
        const x = RADIUS - Math.sqrt(Math.max(0, RADIUS * RADIUS - y * y))
        const tilt = (-Math.asin(Math.max(-1, Math.min(1, y / RADIUS))) * 180) / Math.PI
        const distance = Math.abs(offset)
        const centred = distance < 0.5
        return (
          <button
            key={section.id}
            role="option"
            aria-selected={settled === section.id}
            className={`gwheel__item${centred ? ' is-centre' : ''}`}
            style={{
              left: 0,
              transform: `translate(calc(${ITEM_EDGE}px - 100% + ${x.toFixed(1)}px), ${(height / 2 + y).toFixed(1)}px) rotate(${(tilt * 0.55).toFixed(2)}deg) scale(${(1 - Math.min(distance, 3) * 0.05).toFixed(3)})`,
              opacity: Math.max(0, 1 - distance * 0.3),
              ['--hue' as string]: section.hue,
            }}
            tabIndex={-1}
            onClick={() => {
              if (drag.current?.moved === true) return
              onPick(index)
            }}
          >
            <span className="gwheel__label">{section.name}</span>
            <span className="gwheel__icon">
              <Icon name={section.icon} size={17} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
