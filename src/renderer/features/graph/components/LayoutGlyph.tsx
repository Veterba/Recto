import type { LayoutMode, TreeDirection } from '../layout'

export const LAYOUTS: { mode: LayoutMode; name: string; hint: string }[] = [
  { mode: 'organic', name: 'Organic', hint: 'Clusters find their own place' },
  { mode: 'tree', name: 'Tree', hint: 'Branches from the best-linked note' },
  { mode: 'radial', name: 'Radial', hint: 'Hubs in the middle, the rest around them' },
  { mode: 'circle', name: 'Circle', hint: 'Every linked note on one ring' },
  { mode: 'clusters', name: 'Folders', hint: 'One island per top-level folder' },
]

export const DIRECTIONS: { direction: TreeDirection; label: string; icon: string }[] = [
  { direction: 'down', label: 'Down', icon: '↓' },
  { direction: 'up', label: 'Up', icon: '↑' },
  { direction: 'right', label: 'Right', icon: '→' },
  { direction: 'left', label: 'Left', icon: '←' },
  { direction: 'out', label: 'Outward', icon: '◎' },
]

/** A tiny drawing of each layout, so the choice is visual rather than a word. */
export function LayoutGlyph({ mode }: { mode: LayoutMode }): React.ReactElement {
  const dot = (cx: number, cy: number, r = 1.8): React.ReactElement => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
  const line = (x1: number, y1: number, x2: number, y2: number): React.ReactElement => (
    <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
  )
  let shapes: React.ReactElement[]
  switch (mode) {
    case 'tree':
      shapes = [
        line(16, 5, 8, 15),
        line(16, 5, 24, 15),
        line(8, 15, 4, 25),
        line(8, 15, 12, 25),
        line(24, 15, 20, 25),
        line(24, 15, 28, 25),
        dot(16, 5, 2.4),
        dot(8, 15),
        dot(24, 15),
        dot(4, 25, 1.4),
        dot(12, 25, 1.4),
        dot(20, 25, 1.4),
        dot(28, 25, 1.4),
      ]
      break
    case 'radial':
      shapes = [
        line(16, 15, 6, 8),
        line(16, 15, 26, 7),
        line(16, 15, 27, 22),
        line(16, 15, 6, 23),
        line(16, 15, 16, 27),
        dot(16, 15, 3),
        dot(6, 8),
        dot(26, 7),
        dot(27, 22),
        dot(6, 23),
        dot(16, 27),
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
        line(8, 9, 5, 5),
        line(8, 9, 12, 5),
        line(8, 9, 5, 13),
        line(23, 10, 27, 6),
        line(23, 10, 28, 13),
        line(15, 23, 11, 27),
        line(15, 23, 20, 27),
        line(8, 9, 15, 23),
        dot(8, 9, 2.4),
        dot(5, 5, 1.4),
        dot(12, 5, 1.4),
        dot(5, 13, 1.4),
        dot(23, 10, 2.4),
        dot(27, 6, 1.4),
        dot(28, 13, 1.4),
        dot(15, 23, 2.4),
        dot(11, 27, 1.4),
        dot(20, 27, 1.4),
      ]
      break
    default:
      shapes = [
        line(10, 9, 18, 14),
        line(18, 14, 25, 7),
        line(18, 14, 21, 24),
        line(10, 9, 5, 18),
        line(21, 24, 11, 25),
        line(25, 7, 28, 17),
        dot(10, 9),
        dot(18, 14, 2.6),
        dot(25, 7),
        dot(21, 24),
        dot(5, 18, 1.4),
        dot(11, 25, 1.4),
        dot(28, 17, 1.4),
      ]
  }
  return (
    <svg className="gset__glyph" viewBox="0 0 32 30" aria-hidden="true">
      {shapes}
    </svg>
  )
}
