import { describe, expect, it } from 'vitest'
import { step, still, zoomAt, MAX_ZOOM, MIN_ZOOM } from '../src/renderer/graph/camera-motion'
import { screenToWorld } from '../src/renderer/graph/renderer'

const W = 800
const H = 600

describe('zoomAt', () => {
  /** The contract of pointer-anchored zoom: the point you scrolled over stays put. */
  it('targets a camera that keeps the pointed-at world point under the pointer', () => {
    const start = { x: 40, y: -20, zoom: 1 }
    const motion = zoomAt(still(start), 650, 120, 1.8, W, H)
    const before = screenToWorld(start, 650, 120, W, H)
    const after = screenToWorld(motion.target, 650, 120, W, H)
    expect(after[0]).toBeCloseTo(before[0], 6)
    expect(after[1]).toBeCloseTo(before[1], 6)
  })

  it('clamps the zoom', () => {
    expect(zoomAt(still({ x: 0, y: 0, zoom: 1 }), 0, 0, 1e6, W, H).target.zoom).toBe(MAX_ZOOM)
    expect(zoomAt(still({ x: 0, y: 0, zoom: 1 }), 0, 0, 1e-6, W, H).target.zoom).toBe(MIN_ZOOM)
  })

  /** A burst of wheel events accumulates rather than each restarting the animation. */
  it('builds on the target, so repeated events compound', () => {
    let motion = still({ x: 0, y: 0, zoom: 1 })
    for (let i = 0; i < 3; i++) motion = zoomAt(motion, 400, 300, 1.25, W, H)
    expect(motion.target.zoom).toBeCloseTo(1.25 ** 3, 6)
  })
})

describe('step', () => {
  it('eases toward the target and arrives', () => {
    let camera = { x: 0, y: 0, zoom: 1 }
    let motion = still(camera)
    motion = { ...motion, target: { x: 300, y: -150, zoom: 2 } }
    let frames = 0
    let moving = true
    while (moving && frames < 300) {
      ;({ camera, motion, moving } = step(camera, motion, 16.7, W, H))
      frames++
    }
    expect(moving).toBe(false)
    expect(camera).toEqual({ x: 300, y: -150, zoom: 2 })
    // Smooth, not instant: it took a handful of frames, not one.
    expect(frames).toBeGreaterThan(5)
  })

  /** Pinned the whole way, not just at the end. */
  it('keeps the anchored point under the pointer at every frame of a zoom', () => {
    let camera = { x: 10, y: 10, zoom: 1 }
    let motion = zoomAt(still(camera), 200, 450, 3, W, H)
    const anchor = motion.anchor!
    for (let i = 0; i < 10; i++) {
      ;({ camera, motion } = step(camera, motion, 16.7, W, H))
      const [wx, wy] = screenToWorld(camera, 200, 450, W, H)
      expect(wx).toBeCloseTo(anchor.wx, 6)
      expect(wy).toBeCloseTo(anchor.wy, 6)
    }
  })

  it('glides after a pan and comes to a stop', () => {
    let camera = { x: 0, y: 0, zoom: 1 }
    let motion = { ...still(camera), velocity: { x: 0.5, y: 0 } }
    let moving = true
    let frames = 0
    while (moving && frames < 600) {
      ;({ camera, motion, moving } = step(camera, motion, 16.7, W, H))
      frames++
    }
    expect(moving).toBe(false)
    expect(camera.x).toBeGreaterThan(20)
    expect(frames).toBeLessThan(600)
  })

  it('is frame-rate independent: 120 Hz and 60 Hz end up in the same place', () => {
    const run = (dt: number, n: number): number => {
      let camera = { x: 0, y: 0, zoom: 1 }
      let motion = { ...still(camera), target: { x: 100, y: 0, zoom: 1 } }
      for (let i = 0; i < n; i++) ({ camera, motion } = step(camera, motion, dt, W, H))
      return camera.x
    }
    expect(run(1000 / 120, 20)).toBeCloseTo(run(1000 / 60, 10), 1)
  })

  it('snaps with reduced motion', () => {
    const camera = { x: 0, y: 0, zoom: 1 }
    const result = step(camera, { ...still(camera), target: { x: 500, y: 0, zoom: 3 } }, 16.7, W, H, true)
    expect(result.camera).toEqual({ x: 500, y: 0, zoom: 3 })
  })
})
