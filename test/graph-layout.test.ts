import { describe, expect, it } from 'vitest'
import { coerceLayout, DEFAULT_LAYOUT, layoutTargets, spanningForest, treeEdgeIndices, type GraphLayout } from '../src/renderer/graph/layout'

/** A hub (0) with three children, one of which (1) has two children; plus two unlinked notes. */
const COUNT = 8
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [1, 5],
]
const layout = (patch: Partial<GraphLayout>): GraphLayout => ({ ...DEFAULT_LAYOUT, ...patch })

describe('spanningForest', () => {
  it('roots each group at its best-linked note, biggest group first', () => {
    const forest = spanningForest(COUNT, EDGES)
    expect(forest.roots[0]).toBe(0)
    expect(forest.depth[4]).toBe(2)
    expect(forest.parent[4]).toBe(1)
    // The two unlinked notes are groups of one.
    expect(forest.roots).toContain(6)
    expect(forest.roots).toContain(7)
  })

  it('survives a cycle', () => {
    const forest = spanningForest(3, [
      [0, 1],
      [1, 2],
      [2, 0],
    ])
    expect([...forest.depth].every((d) => d >= 0)).toBe(true)
  })
})

describe('layoutTargets', () => {
  it('leaves the organic layout to the forces', () => {
    expect(layoutTargets(COUNT, EDGES, layout({ mode: 'organic' }), null, 60)).toBeNull()
  })

  it('grows a tree downward: children below their parent', () => {
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'down' }), null, 60)!
    expect(t.y[1]!).toBeGreaterThan(t.y[0]!)
    expect(t.y[4]!).toBeGreaterThan(t.y[1]!)
    // Siblings share a level.
    expect(t.y[2]!).toBeCloseTo(t.y[1]!)
  })

  it('points the same tree up, right and left', () => {
    const up = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'up' }), null, 60)!
    expect(up.y[4]!).toBeLessThan(up.y[0]!)
    const right = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'right' }), null, 60)!
    expect(right.x[4]!).toBeGreaterThan(right.x[0]!)
    const left = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'left' }), null, 60)!
    expect(left.x[4]!).toBeLessThan(left.x[0]!)
  })

  it('grows outward in rings: deeper notes further from the centre', () => {
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'out' }), null, 60)!
    const r = (i: number): number => Math.hypot(t.x[i]!, t.y[i]!)
    expect(r(0)).toBeCloseTo(0)
    expect(r(4)).toBeGreaterThan(r(1))
  })

  it('gives a parent the middle of its children', () => {
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', direction: 'down' }), null, 60)!
    expect(t.x[1]!).toBeCloseTo((t.x[4]! + t.x[5]!) / 2)
  })

  it('puts every linked note on one ring in the circle layout', () => {
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'circle' }), null, 60)!
    const radii = [0, 1, 2, 3, 4, 5].map((i) => Math.hypot(t.x[i]!, t.y[i]!))
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 3)
  })

  it('puts hubs nearer the middle than leaves in the radial layout', () => {
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'radial' }), null, 60)!
    expect(t.radius![0]!).toBeLessThan(t.radius![4]!)
    // Unlinked notes sit outside everything.
    expect(t.radius![6]!).toBeGreaterThan(t.radius![4]!)
  })

  it('gives each folder its own island', () => {
    const groups = [0, 0, 0, 1, 1, 1, 2, 2]
    const t = layoutTargets(COUNT, EDGES, layout({ mode: 'clusters' }), groups, 60)!
    expect(t.x[0]).toBe(t.x[1])
    expect(Math.hypot(t.x[0]! - t.x[3]!, t.y[0]! - t.y[3]!)).toBeGreaterThan(10)
  })

  it('scales with spacing', () => {
    const a = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', spacing: 1 }), null, 60)!
    const b = layoutTargets(COUNT, EDGES, layout({ mode: 'tree', spacing: 2 }), null, 60)!
    expect(b.y[4]! - b.y[0]!).toBeCloseTo((a.y[4]! - a.y[0]!) * 2)
  })
})

describe('coerceLayout', () => {
  it('falls back field by field', () => {
    expect(coerceLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(coerceLayout({ mode: 'tree', direction: 'sideways', spacing: 99 })).toEqual({ mode: 'tree', direction: 'down', spacing: 3 })
  })
})

describe('tidy trees on a real-shaped vault', () => {
  /** Hubs with big fans of leaves, a few chains, some links between hubs. */
  const vault = (): { count: number; edges: [number, number][] } => {
    const edges: [number, number][] = []
    let next = 6
    for (let hub = 0; hub < 6; hub++) {
      const fan = [120, 40, 12, 3, 60, 8][hub]!
      for (let i = 0; i < fan; i++) edges.push([hub, next++])
      if (hub > 0) edges.push([hub - 1, hub])
    }
    // a chain hanging off the first fan
    for (let i = 0; i < 5; i++) edges.push([next - 1 - i, next + i])
    next += 5
    return { count: next + 20, edges } // plus 20 unlinked
  }

  for (const direction of ['down', 'out'] as const) {
    it(`never puts two notes on top of each other (${direction})`, () => {
      const { count, edges } = vault()
      const t = layoutTargets(count, edges, layout({ mode: 'tree', direction }), null, 60)!
      let closest = Infinity
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          closest = Math.min(closest, Math.hypot(t.x[i]! - t.x[j]!, t.y[i]! - t.y[j]!))
        }
      }
      expect(closest).toBeGreaterThan(8)
    })
  }

  it('packs a big fan of leaves instead of laying it out as a line', () => {
    const { count, edges } = vault()
    const t = layoutTargets(count, edges, layout({ mode: 'tree', direction: 'down' }), null, 60)!
    const xs = [...t.x]
    const ys = [...t.y]
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width / height).toBeLessThan(4)
  })

  it('marks exactly the spanning-tree links', () => {
    const { count, edges } = vault()
    const marked = treeEdgeIndices(count, edges)
    // One tree over the linked notes: one link fewer than linked notes.
    expect(marked.size).toBe(count - 20 - 1)
  })
})
