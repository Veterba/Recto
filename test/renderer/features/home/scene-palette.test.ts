import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mixPalette, parseColor, readPalette, toOklab, type Palette } from '../../../../src/renderer/features/home/scene-palette'

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../../../../src/renderer/styles/tokens.css'), 'utf8')

/**
 * One theme block's custom properties, `var(--accent)` resolved against the
 * dark accent. `:root` alone is the base block with the home tokens in it -
 * tokens.css opens more than one.
 */
function block(selector: string): (token: string) => string {
  const start = selector === ':root' ? TOKENS.lastIndexOf(':root {', TOKENS.indexOf('--home-ramp:')) : TOKENS.indexOf(`${selector} {`)
  const body = TOKENS.slice(start, TOKENS.indexOf('\n}', start))
  const props = new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
  return (token) => (props.get(token) ?? '').replace('var(--accent)', 'hsl(258 88% 68%)')
}
const BASE = { meta: 0.78, rule: 0.38 }
const light = (): Palette => readPalette(block(":root[data-theme='light']"), BASE)
const dark = (): Palette => readPalette(block(":root[data-theme='dark']"), BASE)

/** The ramps as they were written into scene-tuning.ts before they became tokens. */
const OLD_RAMP = ['#F3F2EF', '#DCD9D5', '#A9A5A3', '#85828A', '#66708F', '#5A6A9C', '#6F82B8']
const OLD_GLASS = ['#BDCDD1', '#9DBBD2', '#73A0CF', '#4173C9', '#0E097B', '#010003', '#010003']
const lab = (hexes: string[]): Float32Array => new Float32Array(hexes.flatMap((h) => toOklab(parseColor(h)!)))

describe('home palette: colours', () => {
  it('parses the forms the tokens use', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1])
    expect(parseColor('#0F0E13')).toEqual([15 / 255, 14 / 255, 19 / 255])
    expect(parseColor('rgb(20.91 20.91 20.91)')).toEqual([0.082, 0.082, 0.082].map((v) => (v * 255) / 255))
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0])
    const violet = parseColor('hsl(258 88% 68%)')!
    expect(violet.map((v) => Math.round(v * 255))).toEqual([145, 102, 245])
    expect(parseColor('var(--x)')).toBeNull()
    expect(parseColor('rgb(1 2)')).toBeNull()
  })
})

describe('home palette: the light theme is what it was', () => {
  it('reads the same ramps, stops, ink, strengths and grain as the old constants', () => {
    const p = light()
    expect(p.ramp).toEqual(lab(OLD_RAMP))
    expect(p.glass).toEqual(lab(OLD_GLASS))
    expect([...p.rampAt]).toEqual([0, 0.2, 0.4, 0.6, 0.78, 0.92, 1].map(Math.fround))
    expect([...p.glassAt]).toEqual([0, 0.25, 0.45, 0.62, 0.8, 1, 1.0001].map(Math.fround))
    expect([...p.ink]).toEqual([0.082, 0.082, 0.082].map(Math.fround))
    // All ones: the text texture is used exactly as drawn.
    expect([...p.textWeights]).toEqual([1, 1, 1])
    expect(p.grain).toBe(0.046)
    expect(p.statsTo).toBe(1)
  })

  it('both light blocks agree, as do both dark ones', () => {
    const media = TOKENS.indexOf('@media (prefers-color-scheme: light)')
    const inMedia = TOKENS.slice(media, TOKENS.indexOf('\n}\n', media))
    const mediaProps = new Map([...inMedia.matchAll(/(--home-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
    const read = block(":root[data-theme='light']")
    for (const [token, value] of mediaProps) expect(value).toBe(read(token))
    const base = block(':root')
    const darkRead = block(":root[data-theme='dark']")
    for (const token of [
      '--home-ramp',
      '--home-glass-ramp',
      '--home-ink',
      '--home-meta-ink',
      '--home-rule-ink',
      '--home-grain',
      '--home-ground',
      '--home-stats-to',
    ]) {
      expect(darkRead(token)).toBe(base(token))
    }
  })
})

describe('home palette: the dark theme', () => {
  it('runs near-black to violet, ending on the accent', () => {
    const p = dark()
    const first = [...p.ramp.slice(0, 3)]
    const last = [...p.ramp.slice(18, 21)]
    expect(first).toEqual([...toOklab(parseColor('#0f0e13')!)].map(Math.fround))
    expect(last).toEqual([...toOklab(parseColor('hsl(258 88% 68%)')!)].map(Math.fround))
    // Lightness only ever rises from shallow to deep: the inverted depth.
    for (let i = 1; i < 7; i++) expect(p.ramp[i * 3]!).toBeGreaterThan(p.ramp[(i - 1) * 3]!)
  })

  it('light ink, fainter meta and rules, lighter grain, figures read against the shallow end', () => {
    const p = dark()
    expect([...p.ink].map((v) => Math.round(v * 255))).toEqual([236, 234, 242])
    expect(p.textWeights[1]).toBeCloseTo(0.6 / 0.78)
    expect(p.textWeights[2]).toBeCloseTo(0.2 / 0.38)
    expect(p.grain).toBeLessThan(light().grain)
    expect(p.statsTo).toBe(0)
  })
})

describe('home palette: crossfade', () => {
  it('returns the ends exactly and blends in between', () => {
    const a = light()
    const b = dark()
    expect(mixPalette(a, b, 0)).toBe(a)
    expect(mixPalette(a, b, 1)).toBe(b)
    const mid = mixPalette(a, b, 0.5)
    expect(mid.grain).toBeCloseTo((a.grain + b.grain) / 2)
    expect(mid.statsTo).toBe(0.5)
    expect(mid.ramp[0]).toBeCloseTo((a.ramp[0]! + b.ramp[0]!) / 2)
  })
})

describe('home palette: bad tokens fail loudly', () => {
  it('names the token', () => {
    expect(() => readPalette(() => '', BASE)).toThrow(/--home-ink/)
    const read = block(":root[data-theme='dark']")
    expect(() => readPalette((t) => (t === '--home-ramp' ? '#000, #111' : read(t)), BASE)).toThrow(/--home-ramp: 7 colours/)
  })
})
