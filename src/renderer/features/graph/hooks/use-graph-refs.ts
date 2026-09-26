import { useCallback, useRef } from 'react'
import type { RenderState } from '../render-state'
import { DEFAULT_LOOK } from '../look'
import { DEFAULT_LAYOUT } from '../layout'
import { still, type Motion } from '../camera-motion'

/**
 * Everything the graph's worker, draw loop and pointer share, in refs so none
 * of them re-creates the others. React owns none of what moves.
 */
export type GraphRefs = {
  hostRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  workerRef: React.RefObject<Worker | null>
  /** Everything the draw loop reads, in a ref so it never re-creates the loop. */
  state: React.RefObject<RenderState>
  /**
   * Where the nodes are heading, against where they are drawn.
   *
   * The simulation can move a node a long way in one tick - a rebuild, a
   * layout change, a reheat - and drawing that raw makes the graph jump. The
   * draw loop eases what is drawn toward these targets, frame-rate
   * independently, so every change arrives as a glide. Picking uses the drawn
   * positions, so clicking hits the dot you can see.
   */
  targets: React.RefObject<Float32Array>
  dirty: React.RefObject<boolean>
  fitted: React.RefObject<boolean>
  /** Where the camera is heading; the draw loop eases toward it every frame. */
  motion: React.RefObject<Motion>
  moving: React.RefObject<boolean>
  /** Whether any node is still travelling toward its target. */
  easing: React.RefObject<boolean>
  /**
   * The note being dragged, or -1.
   *
   * Every other note eases toward where the physics puts it, which is what
   * makes a rebuild read as movement rather than a cut - but the one in your
   * hand must not: easing it means it trails the pointer, and a dot that lags
   * behind the cursor feels like the app is struggling rather than the note
   * being heavy.
   */
  heldIndex: React.RefObject<number>
  /**
   * Where the hover veil is headed, 0 or 1.
   *
   * `state.focus` says WHICH notes are lit; this says how far the veil has come
   * up, so it eases in and out instead of cutting. The set is kept until the
   * fade reaches zero, or leaving a note would take its neighbourhood away a
   * frame before the veil that hid everything else.
   */
  focusTarget: React.RefObject<number>
  /** Frame the graph again when the simulation settles after a layout change. */
  refitOnSettle: React.RefObject<boolean>
  /** The layout the running simulation was last given. */
  sentLayout: React.RefObject<string>
  /**
   * Positions to frame against: where the nodes are HEADING, not where they are
   * drawn mid-glide, so a fit does not aim at a frame that is still moving.
   */
  framePositions: () => Float32Array
  /** Move the camera at once - for framing a brand-new graph or a resize. */
  jumpCamera: (camera: RenderState['camera']) => void
  /** Move the camera smoothly - for anything the user asked for. */
  glideCamera: (camera: RenderState['camera']) => void
}

export function useGraphRefs(): GraphRefs {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const state = useRef<RenderState>({
    nodes: [],
    edges: [],
    positions: new Float32Array(0),
    active: -1,
    neighbours: new Set(),
    hovered: -1,
    camera: { x: 0, y: 0, zoom: 1 },
    showLabels: true,
    look: DEFAULT_LOOK,
    time: 0,
  })
  const targets = useRef(new Float32Array(0))
  const dirty = useRef(true)
  const fitted = useRef(false)
  const motion = useRef<Motion>(still({ x: 0, y: 0, zoom: 1 }))
  const moving = useRef(false)
  const easing = useRef(false)

  const framePositions = (): Float32Array =>
    targets.current.length === state.current.positions.length ? targets.current : state.current.positions

  const jumpCamera = useCallback((camera: RenderState['camera']) => {
    state.current.camera = camera
    motion.current = still(camera)
    moving.current = false
    dirty.current = true
  }, [])

  const glideCamera = useCallback((camera: RenderState['camera']) => {
    motion.current = { target: camera, anchor: null, velocity: { x: 0, y: 0 } }
    moving.current = true
  }, [])

  const heldIndex = useRef(-1)
  const focusTarget = useRef(0)
  const refitOnSettle = useRef(false)
  const sentLayout = useRef(JSON.stringify(DEFAULT_LAYOUT))

  return {
    hostRef,
    canvasRef,
    workerRef,
    state,
    targets,
    dirty,
    fitted,
    motion,
    moving,
    easing,
    heldIndex,
    focusTarget,
    refitOnSettle,
    sentLayout,
    framePositions,
    jumpCamera,
    glideCamera,
  }
}
