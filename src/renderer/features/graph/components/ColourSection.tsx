import type { PadRange } from '../../../ui/tint'
import { useState, useRef, useCallback } from 'react'
import { gradientAt, type GraphLook, GRAPH_SWATCHES } from '../look'
import { Tip } from '../../../ui/Tip'
import { Icon } from '../../../ui/Icon'
import { type ColorValue, ColorEditor } from '../../../ui/ColorEditor'
import { GraphSwitch } from './GraphSwitch'
import { StepDots } from '../../../ui/Sliders'

export const percent = (value: number): string => `${Math.round(value * 100)}%`

/** Dots on the graph can be near-white or near-black; the sidebar's wash never needs to be. */
const GRAPH_PAD: PadRange = { top: 0.95, bottom: 0.12, saturation: 0.74 }

type ColourTarget = 'dots' | 'links' | 'background'

const TARGETS: readonly { id: ColourTarget; label: string; icon: string }[] = [
  { id: 'dots', label: 'Dots', icon: 'circle-dot' },
  { id: 'links', label: 'Nodes', icon: 'spline' },
  { id: 'background', label: 'Background', icon: 'image' },
]

/**
 * Which colour goes where, drawn rather than described: a row of dots growing
 * from a quiet note to a hub, each in the colour a note of that size gets. A
 * wave runs along it toward the hub, so the direction reads at a glance, and the
 * swap button turns the whole ramp round.
 */
function GradientLegend({
  colors,
  few,
  most,
  onReverse,
}: {
  colors: readonly string[]
  few: string
  most: string
  onReverse: () => void
}): React.ReactElement {
  const [turns, setTurns] = useState(0)
  const DOTS = 7
  if (colors.length === 1) {
    return (
      <p className="glegend glegend--single">
        <span className="glegend__swatch" style={{ background: colors[0] }} />
        Every note in one colour. Add a second colour to run from {few.toLowerCase()} to {most.toLowerCase()}.
      </p>
    )
  }
  return (
    <div className="glegend" aria-label={`${few} to ${most}`}>
      <div className="glegend__row">
        <span className="glegend__end">{few}</span>
        <div className="glegend__track">
          <span
            className="glegend__ramp"
            style={{ background: `linear-gradient(90deg, ${[0, 0.5, 1].map((t) => gradientAt(colors, t)).join(', ')})` }}
          />
          {Array.from({ length: DOTS }, (_, i) => {
            const t = i / (DOTS - 1)
            const size = 6 + t * 12
            return (
              <span
                key={i}
                className="glegend__dot"
                style={{
                  width: size,
                  height: size,
                  background: gradientAt(colors, t),
                  animationDelay: `${i * 110}ms`,
                }}
              />
            )
          })}
        </div>
        <span className="glegend__end">{most}</span>
        <Tip label="Swap the direction">
          <button
            className="glegend__swap"
            aria-label="Swap the direction"
            style={{ transform: `rotate(${turns * 180}deg)` }}
            onClick={() => {
              setTurns((n) => n + 1)
              onReverse()
            }}
          >
            <Icon name="arrow-left-right" size={13} />
          </button>
        </Tip>
      </div>
    </div>
  )
}

export function ColourSection({ look, onLook }: { look: GraphLook; onLook: (next: GraphLook) => void }): React.ReactElement {
  const [target, setTarget] = useState<ColourTarget>('dots')
  const lookRef = useRef(look)
  lookRef.current = look

  const value: ColorValue = target === 'background' ? look.background : { colors: look[target].colors, strength: look[target].strength }

  const onChange = useCallback(
    (patch: Partial<ColorValue>) => {
      const current = lookRef.current
      if (target === 'background') onLook({ ...current, background: { ...current.background, ...patch } })
      else if (target === 'dots') onLook({ ...current, dots: { ...current.dots, ...patch } })
      else onLook({ ...current, links: { ...current.links, ...patch } })
    },
    [onLook, target],
  )

  return (
    <>
      <ColorEditor
        key={target}
        value={value}
        onChange={onChange}
        presets={GRAPH_SWATCHES}
        range={GRAPH_PAD}
        strengthLabel={target === 'background' ? 'Background colour strength' : 'Colour strength'}
        grainHint="Texture over the background"
        emptyHint={
          target === 'dots'
            ? 'Theme colour. Click to pick one — add more to run from few links to most'
            : target === 'links'
              ? 'Theme colour. Click to pick one'
              : 'Theme background. Click to tint it'
        }
        handleLabel={
          target === 'background'
            ? undefined
            : (index, count) => (count < 2 ? null : index === 0 ? 'Few' : index === count - 1 ? 'Most' : 'Mid')
        }
        between={
          target !== 'background' && value.colors.length > 0 && !(target === 'dots' && look.dots.byFolder) ? (
            <GradientLegend
              colors={value.colors}
              few={target === 'dots' ? 'Few links' : 'Quiet notes'}
              most={target === 'dots' ? 'Most links' : 'Between hubs'}
              onReverse={() => onChange({ colors: [...value.colors].reverse() })}
            />
          ) : undefined
        }
        top={TARGETS.map((item) => (
          <Tip key={item.id} label={item.label}>
            <button
              className={`arcpick__mode${target === item.id ? ' is-active' : ''}`}
              aria-label={item.label}
              aria-pressed={target === item.id}
              onClick={() => setTarget(item.id)}
            >
              <Icon name={item.icon} size={17} />
            </button>
          </Tip>
        ))}
      />
      <div className="gset__below">
        {target === 'dots' && (
          <>
            <GraphSwitch
              label="One colour per folder"
              on={look.dots.byFolder}
              onChange={(byFolder) => onLook({ ...look, dots: { ...look.dots, byFolder } })}
            />
            {look.dots.colors.length > 1 && !look.dots.byFolder && (
              <StepDots
                label="Spread of colours"
                value={look.dots.scale}
                options={[
                  { value: 'log', label: 'Balanced' },
                  { value: 'linear', label: 'Linear' },
                ]}
                onChange={(scale) => onLook({ ...look, dots: { ...look.dots, scale } })}
              />
            )}
          </>
        )}
        {target === 'links' && (
          <GraphSwitch
            label="Match the dots they join"
            on={look.links.matchDots}
            onChange={(matchDots) => onLook({ ...look, links: { ...look.links, matchDots } })}
          />
        )}
      </div>
    </>
  )
}
