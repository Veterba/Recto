import { describe, expect, it } from 'vitest'
import { MIN_HEIGHT, MIN_WIDTH, clampGeometry } from '../src/renderer/components/FloatingWindow'

const at = (x: number, y: number, width = 380, height = 420) => ({ x, y, width, height, maximized: false })
const bounds = { width: 1200, height: 800 }

describe('floating window clamping', () => {
  it('leaves a window that is already inside alone', () => {
    expect(clampGeometry(at(100, 100), bounds)).toEqual(at(100, 100))
  })

  it('keeps a grabbable strip on screen when dragged off the right', () => {
    // Fully off-screen means unreachable, with no way to get it back.
    const clamped = clampGeometry(at(5000, 100), bounds)
    expect(clamped.x).toBeLessThanOrEqual(bounds.width)
    expect(clamped.x).toBe(bounds.width - 64)
  })

  it('keeps a grabbable strip on screen when dragged off the left', () => {
    const clamped = clampGeometry(at(-5000, 100), bounds)
    expect(clamped.x + clamped.width).toBeGreaterThanOrEqual(64)
  })

  it('never lets the header go above the top', () => {
    expect(clampGeometry(at(100, -500), bounds).y).toBe(0)
  })

  it('keeps the header reachable when dragged off the bottom', () => {
    const clamped = clampGeometry(at(100, 5000), bounds)
    expect(clamped.y).toBeLessThanOrEqual(bounds.height - 32)
  })

  it('enforces a minimum size', () => {
    const clamped = clampGeometry(at(0, 0, 10, 10), bounds)
    expect(clamped.width).toBe(MIN_WIDTH)
    expect(clamped.height).toBe(MIN_HEIGHT)
  })

  it('caps size to the available area', () => {
    const clamped = clampGeometry(at(0, 0, 9999, 9999), bounds)
    expect(clamped.width).toBe(bounds.width)
    expect(clamped.height).toBe(bounds.height)
  })

  it('survives a viewport smaller than the minimum size', () => {
    // A tiny window must not produce NaN or an inverted clamp.
    const clamped = clampGeometry(at(0, 0), { width: 100, height: 80 })
    expect(clamped.width).toBe(MIN_WIDTH)
    expect(clamped.height).toBe(MIN_HEIGHT)
    expect(Number.isFinite(clamped.x)).toBe(true)
    expect(Number.isFinite(clamped.y)).toBe(true)
  })

  it('preserves the maximized flag', () => {
    expect(clampGeometry({ ...at(0, 0), maximized: true }, bounds).maximized).toBe(true)
  })
})
