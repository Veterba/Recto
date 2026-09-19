import { useCallback, useEffect, useRef, useState } from 'react'
import { ColorEditor, type ColorValue } from '../components/ColorEditor'
import { Icon } from '../components/Icon'
import { PillSlider } from '../components/PillSlider'
import { HistogramRange, RangeSlider, StepDots } from '../components/Sliders'
import { ALL_LINKS, binsToRange, DEGREE_BINS, rangeToBins, type LinkRange } from './degree-bins'
import { Tip } from '../components/Tip'
import type { PadRange } from '../core/sidebar-theme'
import { DEFAULT_LOOK, GRAPH_SWATCHES, gradientAt, type GraphLook } from './look'
import { DEFAULT_LAYOUT, type GraphLayout, type LayoutMode, type TreeDirection } from './layout'
import { DEFAULT_TUNABLES, type Tunables } from './protocol'

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

export type SectionId = 'layout' | 'links' | 'dots' | 'colour' | 'labels' | 'forces'

/** In the order the wheel shows them. "Nodes" are the links, "dots" the notes. */
export const SECTIONS: readonly { id: SectionId; name: string; icon: string; hue: string }[] = [
  { id: 'layout', name: 'Layout', icon: 'network', hue: '#8b5cf6' },
  { id: 'links', name: 'Nodes', icon: 'spline', hue: '#0ea5e9' },
  { id: 'dots', name: 'Dots', icon: 'circle-dot', hue: '#f43f5e' },
  { id: 'colour', name: 'Colour', icon: 'palette', hue: '#f59e0b' },
  { id: 'labels', name: 'Labels', icon: 'type', hue: '#10b981' },
  { id: 'forces', name: 'Forces', icon: 'magnet', hue: '#6366f1' },
]

/**
 * The mark under each Forces slider, at the value the graph starts on.
 *
 * Read off `DEFAULT_TUNABLES` rather than typed in, so a slider can never claim
 * a default the graph does not actually use - and so finding a better starting
 * point is one number to change, not five.
 */
const DEFAULT_MARK: Record<keyof Tunables, readonly { value: number; label: string }[]> = {
  repelStrength: [{ value: DEFAULT_TUNABLES.repelStrength, label: 'Default' }],
  linkDistance: [{ value: DEFAULT_TUNABLES.linkDistance, label: 'Default' }],
  linkStrength: [{ value: DEFAULT_TUNABLES.linkStrength, label: 'Default' }],
  centerStrength: [{ value: DEFAULT_TUNABLES.centerStrength, label: 'Default' }],
  orphanPull: [{ value: DEFAULT_TUNABLES.orphanPull, label: 'Default' }],
}

/** Distance between items along the wheel, and the radius of the arc they sit on. */
const SPACING = 64
const RADIUS = 520
/** Where the items' right edges and the arc sit across the wheel, in px. */
const ITEM_EDGE = 150
const ARC_X = 166
/** How long the wheel waits after the last scroll before settling. */
const SETTLE_MS = 140

type Props = {
  look: GraphLook
  onLook: (next: GraphLook) => void
  layout: GraphLayout
  onLayout: (next: GraphLayout) => void
  tunables: Tunables
  onTunables: (next: Tunables) => void
  /** Notes per link-count bin, for the histogram. */
  linkBins: readonly number[]
  linkRange: LinkRange
  onLinkRange: (next: LinkRange) => void
  /** Notes on screen after filtering. */
  shown: number
  /** Plays the closing animation, then calls this. */
  onClose: () => void
}

// --- the wheel ------------------------------------------------------------------

function useWheelPosition(count: number, onSettle: (index: number) => void): {
  position: number
  nudge: (by: number) => void
  goTo: (index: number) => void
} {
  const [position, setPosition] = useState(0)
  const live = useRef(0)
  const frame = useRef(0)
  const settleTimer = useRef<number | undefined>(undefined)
  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle

  const set = (value: number): void => {
    live.current = value
    setPosition(value)
  }

  /** Spring to a whole item, then report it. */
  const animateTo = useCallback((target: number) => {
    cancelAnimationFrame(frame.current)
    const from = live.current
    const started = performance.now()
    const duration = 320
    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / duration)
      // easeOutBack, gently: arrives with the smallest overshoot, like a detent.
      const c = 1.2
      const eased = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
      set(from + (target - from) * eased)
      if (t < 1) frame.current = requestAnimationFrame(tick)
      else {
        set(target)
        onSettleRef.current(target)
      }
    }
    frame.current = requestAnimationFrame(tick)
  }, [])

  const nudge = useCallback(
    (by: number) => {
      cancelAnimationFrame(frame.current)
      // Past either end it resists, then springs back when it settles.
      let next = live.current + by
      if (next < 0) next = live.current + by * 0.3
      if (next > count - 1) next = live.current + by * 0.3
      set(Math.min(count - 1 + 0.6, Math.max(-0.6, next)))
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(
        () => animateTo(Math.min(count - 1, Math.max(0, Math.round(live.current)))),
        SETTLE_MS,
      )
    },
    [animateTo, count],
  )

  const goTo = useCallback(
    (index: number) => {
      window.clearTimeout(settleTimer.current)
      animateTo(Math.min(count - 1, Math.max(0, index)))
    },
    [animateTo, count],
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      window.clearTimeout(settleTimer.current)
    },
    [],
  )

  return { position, nudge, goTo }
}

function Wheel({
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

// --- the sections ---------------------------------------------------------------

const LAYOUTS: { mode: LayoutMode; name: string; hint: string }[] = [
  { mode: 'organic', name: 'Organic', hint: 'Clusters find their own place' },
  { mode: 'tree', name: 'Tree', hint: 'Branches from the best-linked note' },
  { mode: 'radial', name: 'Radial', hint: 'Hubs in the middle, the rest around them' },
  { mode: 'circle', name: 'Circle', hint: 'Every linked note on one ring' },
  { mode: 'clusters', name: 'Folders', hint: 'One island per top-level folder' },
]

const DIRECTIONS: { direction: TreeDirection; label: string; icon: string }[] = [
  { direction: 'down', label: 'Down', icon: '↓' },
  { direction: 'up', label: 'Up', icon: '↑' },
  { direction: 'right', label: 'Right', icon: '→' },
  { direction: 'left', label: 'Left', icon: '←' },
  { direction: 'out', label: 'Outward', icon: '◎' },
]

/** A tiny drawing of each layout, so the choice is visual rather than a word. */
function LayoutGlyph({ mode }: { mode: LayoutMode }): React.ReactElement {
  const dot = (cx: number, cy: number, r = 1.8): React.ReactElement => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
  const line = (x1: number, y1: number, x2: number, y2: number): React.ReactElement => (
    <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
  )
  let shapes: React.ReactElement[]
  switch (mode) {
    case 'tree':
      shapes = [
        line(16, 5, 8, 15), line(16, 5, 24, 15), line(8, 15, 4, 25), line(8, 15, 12, 25), line(24, 15, 20, 25), line(24, 15, 28, 25),
        dot(16, 5, 2.4), dot(8, 15), dot(24, 15), dot(4, 25, 1.4), dot(12, 25, 1.4), dot(20, 25, 1.4), dot(28, 25, 1.4),
      ]
      break
    case 'radial':
      shapes = [
        line(16, 15, 6, 8), line(16, 15, 26, 7), line(16, 15, 27, 22), line(16, 15, 6, 23), line(16, 15, 16, 27),
        dot(16, 15, 3), dot(6, 8), dot(26, 7), dot(27, 22), dot(6, 23), dot(16, 27),
      ]
      break
    case 'circle': {
      const points = Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2 - Math.PI / 2
        return [16 + Math.cos(a) * 11, 15 + Math.sin(a) * 11] as const
      })
      shapes = [
        line(points[0]![0], points[0]![1], points[4]![0], points[4]![1]),
        line(points[2]![0], points[2]![1], points[7]![0], points[7]![1]),
        line(points[1]![0], points[1]![1], points[5]![0], points[5]![1]),
        ...points.map(([x, y]) => dot(x, y, 1.6)),
      ]
      break
    }
    case 'clusters':
      shapes = [
        line(8, 9, 5, 5), line(8, 9, 12, 5), line(8, 9, 5, 13), line(23, 10, 27, 6), line(23, 10, 28, 13),
        line(15, 23, 11, 27), line(15, 23, 20, 27), line(8, 9, 15, 23),
        dot(8, 9, 2.4), dot(5, 5, 1.4), dot(12, 5, 1.4), dot(5, 13, 1.4), dot(23, 10, 2.4), dot(27, 6, 1.4), dot(28, 13, 1.4),
        dot(15, 23, 2.4), dot(11, 27, 1.4), dot(20, 27, 1.4),
      ]
      break
    default:
      shapes = [
        line(10, 9, 18, 14), line(18, 14, 25, 7), line(18, 14, 21, 24), line(10, 9, 5, 18), line(21, 24, 11, 25), line(25, 7, 28, 17),
        dot(10, 9), dot(18, 14, 2.6), dot(25, 7), dot(21, 24), dot(5, 18, 1.4), dot(11, 25, 1.4), dot(28, 17, 1.4),
      ]
  }
  return (
    <svg className="gset__glyph" viewBox="0 0 32 30" aria-hidden="true">
      {shapes}
    </svg>
  )
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }): React.ReactElement {
  return (
    <div className="gset__row">
      <span className="gset__label">{label}</span>
      <button
        className={`toggle toggle--sm${on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  )
}

const percent = (value: number): string => `${Math.round(value * 100)}%`
const times = (value: number): string => `${value.toFixed(value < 1 ? 2 : 1)}×`

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

function ColourSection({ look, onLook }: { look: GraphLook; onLook: (next: GraphLook) => void }): React.ReactElement {
  const [target, setTarget] = useState<ColourTarget>('dots')
  const lookRef = useRef(look)
  lookRef.current = look

  const value: ColorValue =
    target === 'background'
      ? look.background
      : { colors: look[target].colors, strength: look[target].strength }

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
            <Switch
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
          <Switch
            label="Match the dots they join"
            on={look.links.matchDots}
            onChange={(matchDots) => onLook({ ...look, links: { ...look.links, matchDots } })}
          />
        )}
      </div>
    </>
  )
}

/** A dot's radius range on screen, from the smallest note to the biggest hub. */
const sizeRange = (node: GraphLook['node']): [number, number] => [3 * node.size, node.size * (3 + 7 * node.growth)]

function fromSizeRange(low: number, high: number): Pick<GraphLook['node'], 'size' | 'growth'> {
  const size = Math.min(3, Math.max(0.3, low / 3))
  const growth = Math.min(3, Math.max(0, (high / size - 3) / 7))
  return { size, growth }
}

function SectionBody({
  id,
  look,
  onLook,
  layout,
  onLayout,
  tunables,
  onTunables,
  linkBins,
  linkRange,
  onLinkRange,
  shown,
}: Omit<Props, 'onClose'> & { id: SectionId }): React.ReactElement {
  const setNode = (patch: Partial<GraphLook['node']>): void => onLook({ ...look, node: { ...look.node, ...patch } })
  const setEdge = (patch: Partial<GraphLook['edge']>): void => onLook({ ...look, edge: { ...look.edge, ...patch } })
  const setLabel = (patch: Partial<GraphLook['label']>): void => onLook({ ...look, label: { ...look.label, ...patch } })

  switch (id) {
    case 'layout':
      return (
        <>
          <div className="gset__layouts">
            {LAYOUTS.map((item) => (
              <button
                key={item.mode}
                className={`gset__layout${layout.mode === item.mode ? ' is-on' : ''}`}
                onClick={() => onLayout({ ...layout, mode: item.mode })}
                aria-pressed={layout.mode === item.mode}
                title={item.hint}
              >
                <LayoutGlyph mode={item.mode} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          {layout.mode === 'tree' && (
            <StepDots
              label="Grows"
              value={layout.direction}
              options={DIRECTIONS.map((d) => ({ value: d.direction, label: `${d.icon}  ${d.label}` }))}
              onChange={(direction) => onLayout({ ...layout, direction })}
            />
          )}
          {layout.mode !== 'organic' && (
            <PillSlider
              variant="classic"
              label="Spacing"
              value={layout.spacing}
              min={0.4}
              max={2.5}
              step={0.05}
              format={times}
              marks={[
                { value: 0.6, label: 'Tight' },
                { value: 1, label: 'Default' },
                { value: 2, label: 'Airy' },
              ]}
              onChange={(spacing) => onLayout({ ...layout, spacing })}
            />
          )}
        </>
      )
    case 'links':
      return (
        <>
          <PillSlider variant="inset" label="Thickness" value={look.edge.width} min={0.2} max={5} step={0.1} format={(v) => `${v.toFixed(1)}px`} onChange={(width) => setEdge({ width })} />
          <PillSlider label="Opacity" value={look.edge.opacity} min={0.03} max={1} step={0.01} format={percent} onChange={(opacity) => setEdge({ opacity })} />
          <PillSlider
            variant="classic"
            label="Curve"
            value={look.edge.curve}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            marks={[
              { value: 0, label: 'Straight' },
              { value: 0.5, label: 'Bowed' },
              { value: 1, label: 'Arcs' },
            ]}
            onChange={(curve) => setEdge({ curve })}
          />
          <Switch label="Arrows" on={look.edge.arrows} onChange={(arrows) => setEdge({ arrows })} />
          <Switch label="Signals along links" on={look.edge.pulses} onChange={(pulses) => setEdge({ pulses })} />
          {look.edge.pulses && (
            <StepDots
              label="Signal speed"
              value={nearestOf(look.edge.pulseSpeed, SPEEDS.map((o) => o.value))}
              options={SPEEDS}
              onChange={(pulseSpeed) => setEdge({ pulseSpeed })}
            />
          )}
        </>
      )
    case 'dots': {
      const [small, large] = sizeRange(look.node)
      const [low, high] = rangeToBins(linkRange)
      return (
        <>
          <RangeSlider
            label="Dot size, smallest to biggest"
            low={Math.round(small * 2) / 2}
            high={Math.round(large * 2) / 2}
            min={1}
            max={40}
            step={0.5}
            format={(v) => `${v}`}
            ruler={[1, 10, 20, 30, 40]}
            defaults={sizeRange(DEFAULT_LOOK.node)}
            onChange={(a, b) => setNode(fromSizeRange(a, Math.max(a, b)))}
          />
          <HistogramRange
            label="Links per note"
            bins={DEGREE_BINS.map((bin, i) => ({ label: bin.label, count: linkBins[i] ?? 0 }))}
            low={low}
            high={high}
            summary={`${shown} shown`}
            onChange={(a, b) => onLinkRange(binsToRange(a, b))}
          />
          <PillSlider variant="inset" label="Glow" value={look.node.glow} min={0} max={1} step={0.01} format={percent} onChange={(glow) => setNode({ glow })} />
          <PillSlider label="Opacity" value={look.node.opacity} min={0.15} max={1} step={0.01} format={percent} onChange={(opacity) => setNode({ opacity })} />
          <StepDots
            label="Shape"
            value={look.node.shape}
            options={[
              { value: 'dot', label: 'Dot' },
              { value: 'ring', label: 'Ring' },
            ]}
            onChange={(shape) => setNode({ shape })}
          />
        </>
      )
    }
    case 'colour':
      return <ColourSection look={look} onLook={onLook} />
    case 'labels':
      return (
        <>
          <PillSlider
            variant="classic"
            label="Text size"
            value={look.label.size}
            min={7}
            max={22}
            step={0.5}
            format={(v) => `${v}px`}
            marks={[
              { value: 9, label: 'Small' },
              { value: 12, label: 'Medium' },
              { value: 18, label: 'Large' },
            ]}
            onChange={(size) => setLabel({ size })}
          />
          <StepDots
            label="Which notes get a label"
            value={look.label.density}
            options={[
              { value: 0, label: 'Hubs only' },
              { value: 1, label: 'Well linked' },
              { value: 2, label: 'Linked' },
              { value: 3, label: 'Every note' },
            ]}
            onChange={(density) => setLabel({ density })}
          />
          <PillSlider label="Show from zoom" value={look.label.fadeZoom} min={0.05} max={3} step={0.05} format={times} onChange={(fadeZoom) => setLabel({ fadeZoom })} />
        </>
      )
    case 'forces':
      return (
        <>
          <PillSlider
            variant="inset"
            label="Repel"
            value={tunables.repelStrength}
            min={0}
            max={4000}
            step={10}
            marks={DEFAULT_MARK.repelStrength}
            onChange={(repelStrength) => onTunables({ ...tunables, repelStrength })}
          />
          <PillSlider
            label="Link length"
            value={tunables.linkDistance}
            min={5}
            max={400}
            step={5}
            marks={DEFAULT_MARK.linkDistance}
            onChange={(linkDistance) => onTunables({ ...tunables, linkDistance })}
          />
          <PillSlider
            variant="classic"
            label="Link pull"
            value={tunables.linkStrength}
            min={0}
            max={2}
            step={0.05}
            format={(v) => v.toFixed(2)}
            marks={[
              { value: 0.2, label: 'Loose' },
              ...DEFAULT_MARK.linkStrength,
              { value: 1.6, label: 'Tight' },
            ]}
            onChange={(linkStrength) => onTunables({ ...tunables, linkStrength })}
          />
          <PillSlider
            label="Centre pull"
            value={tunables.centerStrength}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            marks={DEFAULT_MARK.centerStrength}
            onChange={(centerStrength) => onTunables({ ...tunables, centerStrength })}
          />
          <PillSlider
            label="Unlinked pull"
            value={tunables.orphanPull}
            min={0}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            marks={DEFAULT_MARK.orphanPull}
            onChange={(orphanPull) => onTunables({ ...tunables, orphanPull })}
          />
        </>
      )
  }
}

const SPEEDS = [
  { value: 0.4, label: 'Slow' },
  { value: 0.7, label: 'Calm' },
  { value: 1, label: 'Normal' },
  { value: 1.8, label: 'Fast' },
  { value: 3, label: 'Rush' },
] as const satisfies readonly { value: number; label: string }[]

const nearestOf = <T extends number>(value: number, options: readonly T[]): T =>
  options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), options[0]!)

/** Put one section back as it was out of the box. */
function resetSection(id: SectionId, props: Omit<Props, 'onClose'>): void {
  const { look, onLook, layout, onLayout, onTunables, onLinkRange } = props
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

export function GraphPanel(props: Props): React.ReactElement {
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
              <button className="icon-btn" aria-label={`Reset ${section.name.toLowerCase()}`} onClick={() => resetSection(section.id, props)}>
                <Icon name="rotate-ccw" size={13} />
              </button>
            </Tip>
          </header>
          <div className="gset__body">
            <SectionBody id={section.id} {...props} />
          </div>
        </section>
      )}
      <Wheel position={position} settled={settled} onNudge={nudge} onPick={goTo} onClose={close} />
    </div>
  )
}
