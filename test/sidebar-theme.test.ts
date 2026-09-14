import { describe, expect, it } from 'vitest'
import {
  channels,
  coerceSidebarTheme,
  colorAt,
  grainLevels,
  MAX_STOPS,
  nextStop,
  NO_THEME,
  padPosition,
  PRESETS,
  tintCss,
} from '../src/renderer/core/sidebar-theme'
import { wavePath } from '../src/renderer/components/StrengthSlider'

describe('tintCss', () => {
  it('is none when there is no colour', () => {
    expect(tintCss({ colors: [], strength: 50 })).toBe('none')
  })

  it('is none at zero strength, whatever the colours', () => {
    expect(tintCss({ colors: ['#ff0000'], strength: 0 })).toBe('none')
  })

  /**
   * A flat wash still has to be a gradient: it lives in `background-image`, and
   * a bare colour there is an image with no colour in it.
   */
  it('makes one stop a flat wash rather than a bare colour', () => {
    expect(tintCss({ colors: ['#5aaee0'], strength: 50 })).toBe(
      'linear-gradient(rgb(90 174 224 / 0.500), rgb(90 174 224 / 0.500))',
    )
  })

  it('blends several stops', () => {
    expect(tintCss({ colors: ['#000000', '#ffffff'], strength: 100 })).toBe(
      'linear-gradient(160deg, rgb(0 0 0 / 1.000), rgb(255 255 255 / 1.000))',
    )
  })

  it('stops at three, so a long list cannot smuggle in a fourth', () => {
    const css = tintCss({ colors: ['#111111', '#222222', '#333333', '#444444'], strength: 100 })
    expect(css).not.toContain('68 68 68')
  })

  it('ignores anything that is not a hex colour', () => {
    expect(tintCss({ colors: ['red', 'var(--accent)', '#5aaee0'], strength: 40 })).toBe(
      'linear-gradient(rgb(90 174 224 / 0.400), rgb(90 174 224 / 0.400))',
    )
  })
})

describe('channels', () => {
  it('splits a hex colour into space-separated rgb', () => {
    expect(channels('#000000')).toBe('0 0 0')
    expect(channels('#ffffff')).toBe('255 255 255')
    expect(channels('#5aaee0')).toBe('90 174 224')
  })
})

describe('grainLevels', () => {
  it("leaves the theme's own grain exactly as tuned at 50", () => {
    expect(grainLevels(50)).toEqual({ amount: 1, boost: 0 })
  })

  it('is nothing at 0', () => {
    expect(grainLevels(0)).toEqual({ amount: 0, boost: 0 })
  })

  /** The lower half only thins the theme's layer; the heavy one stays out. */
  it('never adds the heavy layer below the middle', () => {
    for (const g of [0, 10, 25, 49, 50]) expect(grainLevels(g).boost).toBe(0)
  })

  it('goes far past the theme at the top', () => {
    const top = grainLevels(100)
    expect(top.boost).toBe(1)
    // The lightest theme base is 0.3; this has to saturate it.
    expect(0.3 * top.amount).toBeGreaterThanOrEqual(1)
  })

  it('only ever increases as the dial turns up', () => {
    let last = grainLevels(0)
    for (let g = 5; g <= 100; g += 5) {
      const next = grainLevels(g)
      expect(next.amount).toBeGreaterThanOrEqual(last.amount)
      expect(next.boost).toBeGreaterThanOrEqual(last.boost)
      last = next
    }
  })

  it('clamps', () => {
    expect(grainLevels(-10)).toEqual(grainLevels(0))
    expect(grainLevels(900)).toEqual(grainLevels(100))
  })
})

describe('coerceSidebarTheme', () => {
  it('falls back on rubbish', () => {
    expect(coerceSidebarTheme(null)).toEqual(NO_THEME)
    expect(coerceSidebarTheme('blue')).toEqual(NO_THEME)
    expect(coerceSidebarTheme({ colors: 'nope' })).toEqual({ ...NO_THEME, colors: [] })
  })

  it('drops colours that are not hex, rather than passing them into CSS', () => {
    expect(coerceSidebarTheme({ colors: ['#5aaee0', 'javascript:alert(1)'] }).colors).toEqual(['#5aaee0'])
  })

  it('clamps strength and grain', () => {
    expect(coerceSidebarTheme({ strength: 900, grain: -5 })).toMatchObject({ strength: 100, grain: 0 })
  })

  /** A theme saved before grain existed must open at the theme's own grain. */
  it('reads an older theme with no grain as the default', () => {
    expect(coerceSidebarTheme({ colors: ['#5aaee0'], angle: 90, strength: 30 })).toEqual({
      colors: ['#5aaee0'],
      strength: 30,
      grain: 50,
    })
  })
})

describe('the pad', () => {
  it('always yields a real hex colour, even off the edges', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [-3, 7],
      [0.5, 0.5],
    ] as const) {
      expect(colorAt(x, y)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  /**
   * The property the drag depends on: a colour picked on the pad goes back to
   * the point it was picked at, or the handle jumps under the cursor.
   */
  it('round-trips a point through a colour and back', () => {
    for (const [x, y] of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.8, 0.9],
    ] as const) {
      const back = padPosition(colorAt(x, y))
      expect(back.x).toBeCloseTo(x, 1)
      expect(back.y).toBeCloseTo(y, 1)
    }
  })

  it('puts lighter colours higher', () => {
    expect(padPosition('#f0d0e0').y).toBeLessThan(padPosition('#402030').y)
  })

  it('does not throw on a bad colour', () => {
    expect(padPosition('nope')).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('nextStop', () => {
  it('is never the colour it was given', () => {
    expect(nextStop(['#5aaee0'])).not.toBe('#5aaee0')
  })

  it('has a colour to offer for an empty gradient', () => {
    expect(nextStop([])).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('PRESETS', () => {
  it('never offers more stops than the editor can hold', () => {
    for (const preset of PRESETS) expect(preset.colors.length).toBeLessThanOrEqual(MAX_STOPS)
  })

  it('is all real hex, since these go straight into CSS', () => {
    for (const preset of PRESETS) {
      for (const color of preset.colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('wavePath', () => {
  const crest = (d: string): number => {
    const ys = [...d.matchAll(/[ML]\d+ ([\d.]+)/g)].map((m) => Number(m[1]))
    return Math.max(...ys) - Math.min(...ys)
  }

  it('is a flat line at 0', () => {
    expect(crest(wavePath(0, 0))).toBe(0)
  })

  it('gets wavier as the value rises', () => {
    let last = -1
    for (const v of [0, 10, 25, 50, 75, 100]) {
      const h = crest(wavePath(v, 0))
      expect(h).toBeGreaterThan(last)
      last = h
    }
  })

  /** Square-root growth: the low end, where subtle tints live, must show. */
  it('is already clearly wavy at a quarter', () => {
    expect(crest(wavePath(25, 0))).toBeGreaterThan(crest(wavePath(100, 0)) * 0.4)
  })

  it('stays inside its box at the top', () => {
    const ys = [...wavePath(100, 3).matchAll(/[ML]\d+ ([\d.]+)/g)].map((m) => Number(m[1]))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(24)
  })
})
