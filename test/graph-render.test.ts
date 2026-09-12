import { describe, expect, it } from 'vitest'
import {
  anyVisible,
  fit,
  pick,
  radiusOf,
  screenToWorld,
  worldToScreen,
  type Camera,
  type RenderState,
} from '../src/renderer/graph/renderer'

/**
 * The graph's maths, not its pixels.
 *
 * Everything here decides where a click lands and whether a node is on screen,
 * which is the part that is wrong silently: a picking bug does not throw, it
 * just opens the wrong note, or no note at all.
 */

const WIDTH = 800
const HEIGHT = 600

const stateWith = (positions: number[], camera: Camera, degrees: number[] = []): RenderState => ({
  nodes: positions
    .filter((_, i) => i % 2 === 0)
    .map((_, i) => ({ path: `n${i}.md`, label: `n${i}`, degree: degrees[i] ?? 0 })),
  edges: [],
  positions: new Float32Array(positions),
  active: -1,
  neighbours: new Set(),
  hovered: -1,
  camera,
  showLabels: true,
})

describe('camera transforms', () => {
  it('puts the camera centre in the middle of the canvas', () => {
    expect(worldToScreen({ x: 10, y: -4, zoom: 2 }, 10, -4, WIDTH, HEIGHT)).toEqual([WIDTH / 2, HEIGHT / 2])
  })

  it('round-trips screen to world and back at any zoom', () => {
    for (const zoom of [0.05, 0.5, 1, 3.7, 6]) {
      const camera = { x: 120, y: -55, zoom }
      const [wx, wy] = screenToWorld(camera, 317, 201, WIDTH, HEIGHT)
      const [sx, sy] = worldToScreen(camera, wx, wy, WIDTH, HEIGHT)
      expect(sx).toBeCloseTo(317, 6)
      expect(sy).toBeCloseTo(201, 6)
    }
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    // This is the whole contract of pointer-anchored zoom, and getting it wrong
    // makes the graph feel like it slides away from you.
    const camera = { x: 0, y: 0, zoom: 1 }
    const [wx, wy] = screenToWorld(camera, 700, 90, WIDTH, HEIGHT)
    const zoomed = { ...camera, zoom: camera.zoom * 1.1 }
    const [nx, ny] = screenToWorld(zoomed, 700, 90, WIDTH, HEIGHT)
    const corrected = { x: camera.x + (wx - nx), y: camera.y + (wy - ny), zoom: zoomed.zoom }

    const [sx, sy] = worldToScreen(corrected, wx, wy, WIDTH, HEIGHT)
    expect(sx).toBeCloseTo(700, 6)
    expect(sy).toBeCloseTo(90, 6)
  })
})

describe('fit', () => {
  it('centres on the bounding box of the nodes', () => {
    const camera = fit(new Float32Array([-100, -50, 100, 50]), 2, WIDTH, HEIGHT)
    expect(camera.x).toBe(0)
    expect(camera.y).toBe(0)
  })

  it('frames every node inside the canvas', () => {
    const positions = new Float32Array([-4000, -3000, 4000, 3000, 0, 0])
    const camera = fit(positions, 3, WIDTH, HEIGHT)
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = worldToScreen(camera, positions[i * 2]!, positions[i * 2 + 1]!, WIDTH, HEIGHT)
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sx).toBeLessThanOrEqual(WIDTH)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sy).toBeLessThanOrEqual(HEIGHT)
    }
  })

  it('does not divide by zero when every node sits on one point', () => {
    const camera = fit(new Float32Array([7, 7, 7, 7]), 2, WIDTH, HEIGHT)
    expect(Number.isFinite(camera.zoom)).toBe(true)
    expect(camera.zoom).toBeGreaterThan(0)
  })

  it('returns a neutral camera for an empty graph', () => {
    expect(fit(new Float32Array(0), 0, WIDTH, HEIGHT)).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('picking', () => {
  const camera = { x: 0, y: 0, zoom: 1 }

  it('hits a node the cursor is on', () => {
    const state = stateWith([0, 0], camera)
    expect(pick(state, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT)).toBe(0)
  })

  it('misses when the cursor is well clear of every node', () => {
    const state = stateWith([0, 0], camera)
    expect(pick(state, 10, 10, WIDTH, HEIGHT)).toBe(-1)
  })

  it('prefers the nearer node when two overlap', () => {
    const state = stateWith([0, 0, 6, 0], camera)
    // Five pixels right of the first node, so the second is closer.
    expect(pick(state, WIDTH / 2 + 5, HEIGHT / 2, WIDTH, HEIGHT)).toBe(1)
  })

  it('scales its hit area with zoom, so a zoomed-out node is still clickable', () => {
    const tiny = stateWith([0, 0], { x: 0, y: 0, zoom: 0.1 })
    expect(pick(tiny, WIDTH / 2 + 4, HEIGHT / 2, WIDTH, HEIGHT)).toBe(0)
  })
})

describe('visibility after a resize', () => {
  it('sees a node that is on screen', () => {
    const state = stateWith([0, 0], { x: 0, y: 0, zoom: 1 })
    expect(anyVisible(state, WIDTH, HEIGHT)).toBe(true)
  })

  it('reports nothing visible when the camera has been left behind by a shrink', () => {
    // The camera was framing a 1200px-wide panel; the panel is now 200px.
    const state = stateWith([600, 400], { x: 0, y: 0, zoom: 1 })
    expect(anyVisible(state, 200, 150)).toBe(false)
  })

  it('and a fit computed for the new size brings it back', () => {
    const state = stateWith([600, 400], { x: 0, y: 0, zoom: 1 })
    const refitted = { ...state, camera: fit(state.positions, 1, 200, 150) }
    expect(anyVisible(refitted, 200, 150)).toBe(true)
  })

  it('says nothing is visible for an empty graph rather than throwing', () => {
    expect(anyVisible(stateWith([], { x: 0, y: 0, zoom: 1 }), WIDTH, HEIGHT)).toBe(false)
  })
})

describe('node radius', () => {
  it('grows with degree but flattens, so a hub is not a blob', () => {
    expect(radiusOf(0)).toBeLessThan(radiusOf(4))
    expect(radiusOf(4)).toBeLessThan(radiusOf(50))
    expect(radiusOf(10_000)).toBeLessThanOrEqual(10)
  })
})
