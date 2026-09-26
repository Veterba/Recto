import { type GraphLook, DEFAULT_LOOK } from '../look'
import { type GraphPanelProps, type SectionId, DEFAULT_MARK } from '../graph-panel-sections'
import { LAYOUTS, LayoutGlyph, DIRECTIONS } from './LayoutGlyph'
import { StepDots, RangeSlider, HistogramRange } from '../../../ui/Sliders'
import { PillSlider } from '../../../ui/PillSlider'
import { percent, ColourSection } from './ColourSection'
import { GraphSwitch } from './GraphSwitch'
import { rangeToBins, DEGREE_BINS, binsToRange } from '../degree-bins'

const times = (value: number): string => `${value.toFixed(value < 1 ? 2 : 1)}×`

/** A dot's radius range on screen, from the smallest note to the biggest hub. */
const sizeRange = (node: GraphLook['node']): [number, number] => [3 * node.size, node.size * (3 + 7 * node.growth)]

function fromSizeRange(low: number, high: number): Pick<GraphLook['node'], 'size' | 'growth'> {
  const size = Math.min(3, Math.max(0.3, low / 3))
  const growth = Math.min(3, Math.max(0, (high / size - 3) / 7))
  return { size, growth }
}

export function SectionBody({
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
}: Omit<GraphPanelProps, 'onClose'> & { id: SectionId }): React.ReactElement {
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
          <PillSlider
            variant="inset"
            label="Thickness"
            value={look.edge.width}
            min={0.2}
            max={5}
            step={0.1}
            format={(v) => `${v.toFixed(1)}px`}
            onChange={(width) => setEdge({ width })}
          />
          <PillSlider
            label="Opacity"
            value={look.edge.opacity}
            min={0.03}
            max={1}
            step={0.01}
            format={percent}
            onChange={(opacity) => setEdge({ opacity })}
          />
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
          <GraphSwitch label="Arrows" on={look.edge.arrows} onChange={(arrows) => setEdge({ arrows })} />
          <GraphSwitch label="Signals along links" on={look.edge.pulses} onChange={(pulses) => setEdge({ pulses })} />
          {look.edge.pulses && (
            <StepDots
              label="Signal speed"
              value={nearestOf(
                look.edge.pulseSpeed,
                SPEEDS.map((o) => o.value),
              )}
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
          <PillSlider
            variant="inset"
            label="Glow"
            value={look.node.glow}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(glow) => setNode({ glow })}
          />
          <PillSlider
            label="Opacity"
            value={look.node.opacity}
            min={0.15}
            max={1}
            step={0.01}
            format={percent}
            onChange={(opacity) => setNode({ opacity })}
          />
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
          <PillSlider
            label="Show from zoom"
            value={look.label.fadeZoom}
            min={0.05}
            max={3}
            step={0.05}
            format={times}
            onChange={(fadeZoom) => setLabel({ fadeZoom })}
          />
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
            marks={[{ value: 0.2, label: 'Loose' }, ...DEFAULT_MARK.linkStrength, { value: 1.6, label: 'Tight' }]}
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
