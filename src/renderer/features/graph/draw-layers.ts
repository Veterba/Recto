/**
 * The graph's optional layers, each drawn over the links and dots by draw():
 * arrowheads, glow, pulses, the hover veil and the labels.
 */

import type { GraphLook } from './look'
import type { Palette } from './palette'
import { worldToScreen, radiusIn } from './geometry'
import { glowSprite } from './sprites'
import type { RenderState } from './render-state'
import { fitLabel } from './draw-labels'

/** Arrowheads on the links, once zoomed in far enough to read them. */
export function drawArrows({
  active,
  bend,
  camera,
  context,
  edgeColour,
  edgeWidth,
  edges,
  height,
  highlighting,
  look,
  nodes,
  palette,
  positions,
  visibleEdges,
  width,
  zoomScale,
}: {
  active: number
  bend: number
  camera: import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').Camera
  context: CanvasRenderingContext2D
  edgeColour: (a: number, b: number) => string
  edgeWidth: number
  edges: readonly [number, number][]
  height: number
  highlighting: boolean
  look: GraphLook
  nodes: readonly import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').GraphNodeView[]
  palette: Palette
  positions: Float32Array<ArrayBufferLike>
  visibleEdges: number[]
  width: number
  zoomScale: number
}): void {
  // --- arrows, pointing at the note a link goes to ---------------------------
  if (look.edge.arrows && camera.zoom > 0.35 && visibleEdges.length < 4000) {
    const heads = new Map<string, number[]>()
    for (const index of visibleEdges) {
      const [a, b] = edges[index]!
      const [x1, y1] = worldToScreen(camera, positions[a * 2] ?? 0, positions[a * 2 + 1] ?? 0, width, height)
      const [x2, y2] = worldToScreen(camera, positions[b * 2] ?? 0, positions[b * 2 + 1] ?? 0, width, height)
      // Direction at the end of the curve: from the control point to the tip.
      const cx = bend === 0 ? x1 : (x1 + x2) / 2 - (y2 - y1) * bend
      const cy = bend === 0 ? y1 : (y1 + y2) / 2 + (x2 - x1) * bend
      const length = Math.hypot(x2 - cx, y2 - cy)
      if (length < 1) continue
      const ux = (x2 - cx) / length
      const uy = (y2 - cy) / length
      const back = radiusIn(look, nodes[b]?.degree ?? 0) * zoomScale + 1.5
      const tipX = x2 - ux * back
      const tipY = y2 - uy * back
      const size = 3 + edgeWidth * 1.5
      const colour = highlighting && (a === active || b === active) ? palette.edgeActive : edgeColour(a, b)
      let batch = heads.get(colour)
      if (batch === undefined) {
        batch = []
        heads.set(colour, batch)
      }
      batch.push(
        tipX,
        tipY,
        tipX - ux * size * 2 - uy * size,
        tipY - uy * size * 2 + ux * size,
        tipX - ux * size * 2 + uy * size,
        tipY - uy * size * 2 - ux * size,
      )
    }
    for (const [colour, coords] of heads) {
      context.globalAlpha = Math.min(1, look.edge.opacity + 0.25)
      context.fillStyle = colour
      context.beginPath()
      for (let i = 0; i < coords.length; i += 6) {
        context.moveTo(coords[i]!, coords[i + 1]!)
        context.lineTo(coords[i + 2]!, coords[i + 3]!)
        context.lineTo(coords[i + 4]!, coords[i + 5]!)
      }
      context.fill()
    }
  }
}

/** The glow under the dots. */
export function drawGlow({
  active,
  camera,
  context,
  height,
  hovered,
  look,
  nodeColours,
  nodes,
  positions,
  surface,
  width,
  zoomScale,
}: {
  active: number
  camera: import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').Camera
  context: CanvasRenderingContext2D
  height: number
  hovered: number
  look: GraphLook
  nodeColours: string[]
  nodes: readonly import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').GraphNodeView[]
  positions: Float32Array<ArrayBufferLike>
  surface: { dark: boolean; edge: string; node: string; orphan: string; label: string }
  width: number
  zoomScale: number
}): void {
  // --- glow, under the nodes ---------------------------------------------------
  if (look.node.glow > 0 && typeof context.drawImage === 'function') {
    const previous = context.globalCompositeOperation
    // Light adds up on a dark ground, which is what makes a dense hub bloom;
    // on a light ground adding light would bleach it, so it is laid on instead.
    context.globalCompositeOperation = surface.dark ? 'lighter' : 'source-over'
    // Fainter when zoomed out, where hundreds of halos stack into one white glare.
    context.globalAlpha = look.node.glow * (surface.dark ? 0.55 : 0.35) * Math.min(1, 0.3 + zoomScale * 0.7)
    for (let i = 0; i < nodes.length; i++) {
      const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
      const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale * (2.2 + look.node.glow * 3)
      if (sx < -r || sy < -r || sx > width + r || sy > height + r) continue
      // The open note and the hovered one have their own emphasis; a halo on
      // top of it read as a smudge around the ring.
      if (i === active || i === hovered) continue
      const sprite = glowSprite(nodeColours[i] ?? surface.node)
      if (sprite !== null) context.drawImage(sprite, sx - r, sy - r, r * 2, r * 2)
    }
    context.globalCompositeOperation = previous
  }
}

/** Signals travelling along the links. */
export function drawPulses({
  bend,
  camera,
  context,
  edgeColour,
  edgeWidth,
  edges,
  height,
  look,
  nodeColours,
  positions,
  state,
  surface,
  visibleEdges,
  width,
  zoomScale,
}: {
  bend: number
  camera: import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').Camera
  context: CanvasRenderingContext2D
  edgeColour: (a: number, b: number) => string
  edgeWidth: number
  edges: readonly [number, number][]
  height: number
  look: GraphLook
  nodeColours: string[]
  positions: Float32Array<ArrayBufferLike>
  state: RenderState
  surface: { dark: boolean; edge: string; node: string; orphan: string; label: string }
  visibleEdges: number[]
  width: number
  zoomScale: number
}): void {
  // --- pulses: signals travelling along the links ------------------------------
  if (look.edge.pulses && state.time !== undefined && visibleEdges.length > 0) {
    const stride = Math.max(1, Math.ceil(visibleEdges.length / MAX_PULSES))
    const dots = new Map<string, number[]>()
    const clock = (state.time / 1000) * look.edge.pulseSpeed * 0.45
    for (let k = 0; k < visibleEdges.length; k += stride) {
      const index = visibleEdges[k]!
      const [a, b] = edges[index]!
      const [x1, y1] = worldToScreen(camera, positions[a * 2] ?? 0, positions[a * 2 + 1] ?? 0, width, height)
      const [x2, y2] = worldToScreen(camera, positions[b * 2] ?? 0, positions[b * 2 + 1] ?? 0, width, height)
      // Each link fires on its own rhythm, so the graph flickers like activity
      // rather than marching in step.
      const phase = ((index * 0.618034) % 1) + clock * (0.6 + ((index * 0.37) % 0.8))
      const t = phase % 1
      const [px, py] = along(x1, y1, x2, y2, bend, t)
      const colour =
        look.links.colors.length > 0 && !look.links.matchDots ? edgeColour(a, b) : (nodeColours[t < 0.5 ? a : b] ?? surface.node)
      let batch = dots.get(colour)
      if (batch === undefined) {
        batch = []
        dots.set(colour, batch)
      }
      // Brightest mid-flight, so a signal appears and fades instead of popping.
      batch.push(px, py, Math.sin(Math.PI * t))
    }
    const size = Math.max(1.2, 1.8 * zoomScale) * Math.max(0.8, edgeWidth)
    for (const [colour, coords] of dots) {
      context.fillStyle = colour
      for (let i = 0; i < coords.length; i += 3) {
        context.globalAlpha = 0.25 + 0.75 * coords[i + 2]!
        context.beginPath()
        context.arc(coords[i]!, coords[i + 1]!, size, 0, Math.PI * 2)
        context.fill()
      }
    }
  }
}

/** The hover veil and the lit neighbourhood above it, with its names. */
export function drawVeil({
  active,
  autoEdges,
  camera,
  context,
  edgeWidth,
  edges,
  focus,
  focusFade,
  height,
  look,
  nodeColours,
  nodes,
  paint,
  palette,
  positions,
  surface,
  width,
  zoomScale,
}: {
  active: number
  autoEdges: ReadonlySet<number> | undefined
  camera: import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').Camera
  context: CanvasRenderingContext2D
  edgeWidth: number
  edges: readonly [number, number][]
  focus: ReadonlySet<number> | null
  focusFade: number
  height: number
  look: GraphLook
  nodeColours: string[]
  nodes: readonly import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').GraphNodeView[]
  paint: (colour: string, coords: number[], alpha: number, hollow?: boolean) => void
  palette: Palette
  positions: Float32Array<ArrayBufferLike>
  surface: { dark: boolean; edge: string; node: string; orphan: string; label: string }
  width: number
  zoomScale: number
}): void {
  if (focus !== null && focus.size > 0 && focusFade > 0.002) {
    context.globalAlpha = 0.62 * focusFade
    // The ground the graph is drawn on, so the veil hides rather than tints.
    context.fillStyle = surface.dark ? '#171717' : '#fafafa'
    context.fillRect(0, 0, width, height)
    context.globalAlpha = 1

    const lit: number[] = []
    for (const i of focus) {
      const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
      const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale
      if (sx < -r || sy < -r || sx > width + r || sy > height + r) continue
      lit.push(i, sx, sy, r)
    }
    context.globalAlpha = 0.9 * focusFade
    context.strokeStyle = surface.edge
    // Manual links solid, topic links thin and dashed - the same distinction
    // the veil is lifted off, or hovering would make every link look manual.
    for (const autoPass of [false, true]) {
      const focusWidth = Math.max(1, edgeWidth * zoomScale)
      context.lineWidth = autoPass ? Math.max(0.5, focusWidth * 0.6) : focusWidth
      context.setLineDash?.(autoPass ? [Math.max(2, 3 * focusWidth * 0.6), Math.max(2, 3 * focusWidth * 0.6)] : [])
      context.beginPath()
      edges.forEach(([a, b], index) => {
        if (!focus.has(a) || !focus.has(b) || (autoEdges?.has(index) === true) !== autoPass) return
        const [x1, y1] = worldToScreen(camera, positions[a * 2] ?? 0, positions[a * 2 + 1] ?? 0, width, height)
        const [x2, y2] = worldToScreen(camera, positions[b * 2] ?? 0, positions[b * 2 + 1] ?? 0, width, height)
        context.moveTo(x1, y1)
        context.lineTo(x2, y2)
      })
      context.stroke()
    }
    context.setLineDash?.([])
    for (let k = 0; k < lit.length; k += 4) {
      const i = lit[k]!
      paint(
        i === active ? palette.nodeActive : (nodeColours[i] ?? surface.node),
        [lit[k + 1]!, lit[k + 2]!, lit[k + 3]!],
        focusFade,
        nodes[i]?.topic === true,
      )
    }
    /*
     * Their names too: the neighbourhood is worth reading, not just seeing.
     *
     * A shade smaller than the labels elsewhere, and less eager to grow with
     * the zoom: nothing else is drawn while the veil is up, so these are the
     * only text on screen and at full size they read as shouting.
     */
    const focusSize = look.label.size * 0.85 * Math.max(0.82, Math.min(1.1, camera.zoom))
    context.font = `${focusSize}px -apple-system, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'
    context.globalAlpha = focusFade
    context.fillStyle = surface.label
    for (let k = 0; k < lit.length; k += 4) {
      const i = lit[k]!
      const label = nodes[i]?.label
      if (label === undefined) continue
      context.fillText(fitLabel(context, label, focusSize * 16), lit[k + 1]!, lit[k + 2]! + lit[k + 3]! + 4)
    }
  }
}

/** Signals drawn at most per frame, however many links there are. */
const MAX_PULSES = 420

/** Where along a link a point at `t` is, on the same curve the link is drawn with. */
function along(x1: number, y1: number, x2: number, y2: number, bend: number, t: number): [number, number] {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend
  const my = (y1 + y2) / 2 + (x2 - x1) * bend
  const u = 1 - t
  return [u * u * x1 + 2 * u * t * mx + t * t * x2, u * u * y1 + 2 * u * t * my + t * t * y2]
}
