import { describe, expect, it } from 'vitest'
import {
  anyVisible,
  draw,
  fit,
  pick,
  radiusOf,
  screenToWorld,
  worldToScreen,
  type Camera,
  type Palette,
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
    // Flat to six links - Obsidian's floor - then growing, then capped.
    expect(radiusOf(4)).toBe(radiusOf(0))
    expect(radiusOf(4)).toBeLessThan(radiusOf(50))
    expect(radiusOf(10_000)).toBeLessThanOrEqual(10)
  })
})

describe('the open note does not hide the rest', () => {
  /** A context that records the opacity of every fill and stroke. */
  function recordingContext(): { context: CanvasRenderingContext2D; fills: number[]; strokes: number[] } {
    const fills: number[] = []
    const strokes: number[] = []
    const fake = {
      globalAlpha: 1,
      clearRect: (): void => {},
      beginPath: (): void => {},
      moveTo: (): void => {},
      lineTo: (): void => {},
      arc: (): void => {},
      fillText: (): void => {},
      fill: (): void => {
        fills.push(fake.globalAlpha)
      },
      stroke: (): void => {
        strokes.push(fake.globalAlpha)
      },
    }
    const context = fake as unknown as CanvasRenderingContext2D
    return { context, fills, strokes }
  }

  const palette: Palette = {
    edge: '#999',
    edgeActive: '#00f',
    node: '#999',
    nodeActive: '#00f',
    nodeOrphan: '#ccc',
    label: '#333',
    labelActive: '#000',
  }

  /**
   * Opening a note used to fade every other note to 25% and every other link
   * to 18%. The graph is for seeing the vault; the open note is found by its
   * own colour, size and ring, so nothing else needs to be dimmed to find it.
   */
  it('draws every note at full opacity when one is open', () => {
    const state = {
      ...stateWith([0, 0, 40, 0, 80, 0, 120, 0], { x: 60, y: 0, zoom: 1 }, [1, 2, 1, 0]),
      edges: [[0, 1], [1, 2]] as [number, number][],
      active: 0,
      neighbours: new Set([1]),
      showLabels: false,
    }
    const { context, fills, strokes } = recordingContext()
    draw(context, state, palette, WIDTH, HEIGHT)
    // Nodes are batched by colour now, so there are fewer fills than nodes -
    // but every one of them is still at full strength.
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every((alpha) => alpha === 1)).toBe(true)
    // Edges not touching the open note keep the same weight as with none open.
    expect(strokes[0]).toBe(0.55)
  })
})

describe('auto-links are drawn apart from the links you wrote', () => {
  /** Records the dash and width of every stroke. */
  function dashContext(): { context: CanvasRenderingContext2D; strokes: { dash: number[]; width: number }[] } {
    const strokes: { dash: number[]; width: number }[] = []
    let dash: number[] = []
    const fake = {
      globalAlpha: 1,
      lineWidth: 1,
      clearRect: (): void => {},
      fillRect: (): void => {},
      beginPath: (): void => {},
      moveTo: (): void => {},
      lineTo: (): void => {},
      quadraticCurveTo: (): void => {},
      arc: (): void => {},
      fillText: (): void => {},
      measureText: (): { width: number } => ({ width: 10 }),
      fill: (): void => {},
      setLineDash: (next: number[]): void => {
        dash = [...next]
      },
      stroke: (): void => {
        strokes.push({ dash, width: fake.lineWidth })
      },
    }
    return { context: fake as unknown as CanvasRenderingContext2D, strokes }
  }

  const palette: Palette = {
    edge: '#999',
    edgeActive: '#00f',
    node: '#999',
    nodeActive: '#00f',
    nodeOrphan: '#ccc',
    label: '#333',
    labelActive: '#000',
  }
  const base = {
    ...stateWith([0, 0, 40, 0, 80, 0], { x: 40, y: 0, zoom: 1 }, [1, 2, 1]),
    edges: [[0, 1], [1, 2]] as [number, number][],
    autoEdges: new Set([1]),
    showLabels: false,
  }

  it('draws auto-links thinner and dashed, manual links solid', () => {
    const { context, strokes } = dashContext()
    draw(context, base, palette, WIDTH, HEIGHT)
    const solid = strokes.filter((s) => s.dash.length === 0)
    const dashed = strokes.filter((s) => s.dash.length > 0)
    expect(solid.length).toBeGreaterThan(0)
    expect(dashed).toHaveLength(1)
    expect(dashed[0]!.width).toBeLessThan(solid[0]!.width)
  })

  it('keeps them dashed under the hover veil', () => {
    const { context, strokes } = dashContext()
    draw(context, { ...base, focus: new Set([0, 1, 2]), focusFade: 1 }, palette, WIDTH, HEIGHT)
    // Once in the ordinary pass, once more over the veil.
    expect(strokes.filter((s) => s.dash.length > 0)).toHaveLength(2)
  })
})
