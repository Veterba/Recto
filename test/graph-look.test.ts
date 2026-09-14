import { describe, expect, it } from 'vitest'
import {
  coerceLook,
  DEFAULT_LOOK,
  degreeT,
  gradientAt,
  mixColor,
  paintSteps,
  nodeRadius,
  parseHex,
} from '../src/renderer/graph/look'

describe('node radius', () => {
  it('matches the original formula with the default look', () => {
    for (const degree of [0, 1, 4, 20, 500]) {
      expect(nodeRadius(degree)).toBeCloseTo(3 + Math.min(7, Math.sqrt(degree) * 2.2), 10)
    }
  })

  it('makes every node the same size with no growth', () => {
    expect(nodeRadius(0, 1, 0)).toBe(nodeRadius(400, 1, 0))
  })

  it('scales with size', () => {
    expect(nodeRadius(9, 2, 1)).toBeCloseTo(nodeRadius(9) * 2, 10)
  })
})

describe('degreeT', () => {
  it('runs from 0 for no links to 1 for the most-linked note', () => {
    expect(degreeT(0, 50, 'linear')).toBe(0)
    expect(degreeT(50, 50, 'linear')).toBe(1)
    expect(degreeT(25, 50, 'linear')).toBeCloseTo(0.5)
  })

  it('spreads the low end on the balanced scale, where most notes are', () => {
    expect(degreeT(3, 100, 'log')).toBeGreaterThan(degreeT(3, 100, 'linear'))
  })

  it('does not divide by zero in a graph with no links', () => {
    expect(degreeT(0, 0, 'log')).toBe(0)
  })
})

describe('colour', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('22c55e')).toEqual([0x22, 0xc5, 0x5e])
    expect(parseHex('red')).toBeNull()
  })

  it('keeps the ends of a blend exact', () => {
    expect(mixColor('#22c55e', '#ef4444', 0)).toBe('#22c55e')
    expect(mixColor('#22c55e', '#ef4444', 1)).toBe('#ef4444')
  })

  it('goes from green to red through yellow, not brown', () => {
    const [r, g, b] = parseHex(mixColor('#00ff00', '#ff0000', 0.5))!
    expect(r).toBeGreaterThan(200)
    expect(g).toBeGreaterThan(200)
    expect(b).toBeLessThan(40)
  })

  it('uses the middle stop at the midpoint', () => {
    expect(gradientAt(['#000000', '#3366ff', '#ffffff'], 0.5)).toBe('#3366ff')
  })

  it('treats one colour as flat', () => {
    expect(gradientAt(['#3366ff'], 0)).toBe('#3366ff')
    expect(gradientAt(['#3366ff'], 1)).toBe('#3366ff')
  })

  it('mixes toward the theme colour as strength drops, not toward transparent', () => {
    const full = paintSteps({ colors: ['#ff0000'], strength: 100 }, '#808080')
    const none = paintSteps({ colors: ['#ff0000'], strength: 0 }, '#808080')
    expect(full[0]).toBe('#ff0000')
    expect(none[0]).toBe('#808080')
  })
})

describe('coerceLook', () => {
  it('gives the default look for nothing', () => {
    expect(coerceLook(undefined)).toEqual(DEFAULT_LOOK)
    expect(coerceLook('nonsense')).toEqual(DEFAULT_LOOK)
  })

  it('round-trips a look', () => {
    const look = {
      ...DEFAULT_LOOK,
      dots: { colors: ['#22c55e', '#ef4444'], strength: 80, byFolder: false, scale: 'linear' as const },
      background: { colors: ['#0b1224'], strength: 90, grain: 40 },
    }
    expect(coerceLook(JSON.parse(JSON.stringify(look)))).toEqual(look)
  })

  it('reads a look saved by the first version', () => {
    const look = coerceLook({
      color: { mode: 'gradient', from: '#22c55e', via: '#facc15', to: '#ef4444', scale: 'log' },
      edge: { mode: 'custom', color: '#14b8a6', width: 0.7 },
      backdrop: 'space',
    })
    expect(look.dots.colors).toEqual(['#22c55e', '#facc15', '#ef4444'])
    expect(look.links.colors).toEqual(['#14b8a6'])
    expect(look.edge.width).toBe(0.7)
    expect(look.background.colors).toHaveLength(1)
  })

  it('clamps and rejects hand-edited nonsense', () => {
    const look = coerceLook({
      dots: { colors: ['blue', '#12345', '#abcdef', '#abcdef', '#abcdef', '#abcdef'], strength: 900, byFolder: 'yes' },
      node: { size: 1e9, glow: -3 },
      edge: { opacity: 'lots', pulses: 'yes' },
      background: { grain: -5 },
    })
    expect(look.dots.colors).toEqual(['#abcdef', '#abcdef', '#abcdef'])
    expect(look.dots.strength).toBe(100)
    expect(look.dots.byFolder).toBe(false)
    expect(look.node.size).toBe(3)
    expect(look.node.glow).toBe(0)
    expect(look.edge.opacity).toBe(DEFAULT_LOOK.edge.opacity)
    expect(look.edge.pulses).toBe(false)
    expect(look.background.grain).toBe(0)
  })
})
