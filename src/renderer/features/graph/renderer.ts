/**
 * Canvas 2D renderer for the link graph.
 *
 * **A deliberate deviation from the plan, which said PixiJS.** That call came
 * from the Obsidian teardown, where the note was "SVG dies at ~2000 nodes; a
 * WebGL sprite batch does not" - and that is true, but SVG is not the
 * alternative being chosen here. Immediate-mode Canvas 2D is far closer to
 * WebGL than to SVG: no retained scene graph, no per-node DOM.
 *
 * So this starts on Canvas 2D, which costs zero dependencies and ~200 lines,
 * and reports its own frame time. If it cannot hold a frame budget at realistic
 * vault size, the draw call is the only thing that has to change - the worker,
 * the data and the interaction all stay. Adding 400 KB of WebGL on the strength
 * of a comparison to a technology we are not using would be the wrong order.
 *
 * With the Classic look everything colour-related is read from the CSS tokens,
 * so the graph follows the app's theme and accent with no second palette. The
 * other looks bring their own colours, backdrops, glow and motion; the draw
 * stays batched by colour either way, so styling costs a handful of extra
 * stroke and fill calls, not one per node.
 */

import { COLOR_STEPS, DEFAULT_LOOK, degreeT, groupColor, paintSteps, type GraphLook } from './look'
import type { RenderState } from './render-state'
import type { Palette } from './palette'
import { worldToScreen, radiusIn } from './geometry'
import { surfaceFor } from './sprites'
import { drawArrows, drawGlow, drawPulses, drawVeil } from './draw-layers'
import { drawLabels } from './draw-labels'

/** Colours cached per look, so a frame does not rebuild the gradient. */
let stepsFor: GraphLook['dots'] | null = null
let stepsBase = ''
let steps: string[] = []
let linkStepsFor: GraphLook['links'] | null = null
let linkStepsBase = ''
let linkSteps: string[] = []

/**
 * Draw one frame. Returns the time it took, so the UI can show it and so the
 * Canvas-vs-WebGL decision above can be revisited with numbers.
 */
export function draw(context: CanvasRenderingContext2D, state: RenderState, palette: Palette, width: number, height: number): number {
  const started = performance.now()
  const { camera, positions, nodes, edges, active, neighbours, hovered } = state
  const look = state.look ?? DEFAULT_LOOK
  const surface = surfaceFor(look, palette)
  /**
   * Whether a note is open - which ADDS emphasis, and no longer takes any away.
   *
   * It used to fade every other note to a quarter and every other edge to a
   * sixth, which made the open note stand out by making the rest of the vault
   * hard to see. The graph is for seeing the vault; the open note is found by
   * its colour, size, ring and accented links, all of which stay.
   */
  const highlighting = active >= 0

  context.clearRect(0, 0, width, height)

  // --- a colour per node ----------------------------------------------------
  if (stepsFor !== look.dots || stepsBase !== surface.node) {
    stepsFor = look.dots
    stepsBase = surface.node
    steps = paintSteps(look.dots, surface.node)
  }
  if (linkStepsFor !== look.links || linkStepsBase !== surface.edge) {
    linkStepsFor = look.links
    linkStepsBase = surface.edge
    linkSteps = paintSteps(look.links, surface.edge)
  }
  let maxDegree = 0
  for (const node of nodes) maxDegree = Math.max(maxDegree, node.degree)
  const tOf = (i: number): number => degreeT(nodes[i]?.degree ?? 0, maxDegree, look.dots.scale)
  const colourOf = (i: number): string => {
    const node = nodes[i]
    if (look.dots.byFolder) return groupColor(node?.group ?? 0, surface.dark)
    if (look.dots.colors.length > 0) return steps[Math.round(tOf(i) * (COLOR_STEPS - 1))] ?? surface.node
    return (node?.degree ?? 0) === 0 ? surface.orphan : surface.node
  }
  const nodeColours = new Array<string>(nodes.length)
  for (let i = 0; i < nodes.length; i++) nodeColours[i] = colourOf(i)

  /** A link's colour: its notes', its own gradient by how linked its ends are, or the theme's. */
  const edgeColour = (a: number, b: number): string => {
    if (look.links.matchDots) {
      if (look.dots.colors.length > 0 && !look.dots.byFolder) {
        return steps[Math.round(((tOf(a) + tOf(b)) / 2) * (COLOR_STEPS - 1))] ?? surface.edge
      }
      return nodeColours[(nodes[a]?.degree ?? 0) >= (nodes[b]?.degree ?? 0) ? a : b] ?? surface.edge
    }
    if (look.links.colors.length > 0) return linkSteps[Math.round(((tOf(a) + tOf(b)) / 2) * (COLOR_STEPS - 1))] ?? surface.edge
    return surface.edge
  }

  // --- edges, batched by colour ----------------------------------------------
  //
  // One path per colour rather than per edge: a stroke() call per edge is
  // what makes naive canvas graphs slow, not the geometry.
  const bend = look.edge.curve * 0.3
  const plain = new Map<string, number[]>()
  /** Links outside the tree, in a tree layout. */
  const loops = new Map<string, number[]>()
  const lit: number[] = []
  /** Topic links: their own batches, drawn thin and dashed. */
  const dashed = new Map<string, number[]>()
  const litDashed: number[] = []
  const autoEdges = state.autoEdges
  const flow = state.treeEdges != null ? (state.treeDirection ?? null) : null
  const bundleAt = ((): { x: number; y: number; r: number } | null => {
    if (state.bundle !== true || nodes.length === 0) return null
    const [cx, cy] = worldToScreen(camera, 0, 0, width, height)
    // The ring's radius is the typical distance of a linked note from the centre.
    let sum = 0
    let n = 0
    for (let i = 0; i < nodes.length; i++) {
      if ((nodes[i]?.degree ?? 0) === 0) continue
      sum += Math.hypot(positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0)
      n++
    }
    return { x: cx, y: cy, r: Math.max(1, (n === 0 ? 0 : sum / n) * camera.zoom) }
  })()
  // Nodes shrink as you zoom out, but more slowly than the space between them,
  // and never to nothing. Holding them at 60% of size - as it used to - is what
  // turned a dense graph in a small window into one solid blob.
  const zoomScale = Math.max(0.22, Math.min(1.6, Math.pow(camera.zoom, 0.75)))
  const visibleEdges: number[] = []

  edges.forEach(([a, b], index) => {
    const [x1, y1] = worldToScreen(camera, positions[a * 2] ?? 0, positions[a * 2 + 1] ?? 0, width, height)
    const [x2, y2] = worldToScreen(camera, positions[b * 2] ?? 0, positions[b * 2 + 1] ?? 0, width, height)
    // Cheap off-screen rejection, widened by how far a curve can bow out.
    const slack = Math.abs(bend) * (Math.abs(x2 - x1) + Math.abs(y2 - y1))
    if (
      (x1 < -slack && x2 < -slack) ||
      (y1 < -slack && y2 < -slack) ||
      (x1 > width + slack && x2 > width + slack) ||
      (y1 > height + slack && y2 > height + slack)
    ) {
      return
    }
    visibleEdges.push(index)
    const auto = autoEdges?.has(index) === true
    if (highlighting && (a === active || b === active)) {
      ;(auto ? litDashed : lit).push(x1, y1, x2, y2)
      return
    }
    const colour = edgeColour(a, b)
    const target = auto ? dashed : state.treeEdges != null && !state.treeEdges.has(index) ? loops : plain
    let batch = target.get(colour)
    if (batch === undefined) {
      batch = []
      target.set(colour, batch)
    }
    batch.push(x1, y1, x2, y2)
  })

  const strokeBatch = (
    coords: number[],
    colour: string,
    alpha: number,
    lineWidth: number,
    branches = false,
    dash: readonly number[] = [],
  ): void => {
    if (coords.length === 0) return
    context.globalAlpha = alpha
    context.strokeStyle = colour
    context.lineWidth = lineWidth
    context.setLineDash?.(dash)
    context.beginPath()
    for (let i = 0; i < coords.length; i += 4) {
      const x1 = coords[i] ?? 0
      const y1 = coords[i + 1] ?? 0
      const x2 = coords[i + 2] ?? 0
      const y2 = coords[i + 3] ?? 0
      context.moveTo(x1, y1)
      if (branches && (flow === 'down' || flow === 'up')) {
        // A branch leaves its parent straight along the tree's direction and
        // arrives at the child the same way - how a drawn tree reads.
        const my = (y1 + y2) / 2
        context.bezierCurveTo(x1, my, x2, my, x2, y2)
      } else if (branches && (flow === 'left' || flow === 'right')) {
        const mx = (x1 + x2) / 2
        context.bezierCurveTo(mx, y1, mx, y2, x2, y2)
      } else if (bundleAt !== null) {
        // Pulled toward the middle, harder for links between far-apart notes:
        // neighbours stay short arcs by the rim, long links sweep through the
        // centre together instead of a hairball of straight chords.
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const reach = Math.min(1, Math.hypot(x2 - x1, y2 - y1) / Math.max(1, bundleAt.r * 2)) * 0.85
        context.quadraticCurveTo(mx + (bundleAt.x - mx) * reach, my + (bundleAt.y - my) * reach, x2, y2)
      } else if (bend === 0) {
        context.lineTo(x2, y2)
      } else {
        context.quadraticCurveTo((x1 + x2) / 2 - (y2 - y1) * bend, (y1 + y2) / 2 + (x2 - x1) * bend, x2, y2)
      }
    }
    context.stroke()
  }

  const edgeWidth = look.edge.width
  for (const [colour, coords] of loops) strokeBatch(coords, colour, look.edge.opacity * 0.16, edgeWidth * 0.8)
  // A chord diagram of a thousand links is solid ink at normal opacity; thin
  // them by how many there are, so the bundles show.
  const chordFade = bundleAt === null ? 1 : Math.min(1, 220 / Math.max(1, edges.length)) ** 0.6
  for (const [colour, coords] of plain) strokeBatch(coords, colour, look.edge.opacity * chordFade, edgeWidth, flow !== null)
  // Topic links: 0.6 of the width and a short dash, in screen pixels so the
  // rhythm reads the same at every zoom.
  const autoWidth = Math.max(0.5, edgeWidth * 0.6)
  const autoDash = [Math.max(2, 3 * autoWidth), Math.max(2, 3 * autoWidth)]
  for (const [colour, coords] of dashed) strokeBatch(coords, colour, look.edge.opacity * chordFade, autoWidth, flow !== null, autoDash)
  strokeBatch(lit, palette.edgeActive, Math.max(0.9, look.edge.opacity), edgeWidth + 0.5, flow !== null)
  strokeBatch(litDashed, palette.edgeActive, Math.max(0.9, look.edge.opacity), autoWidth + 0.5, flow !== null, autoDash)
  context.setLineDash?.([])
  drawArrows({
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
  })
  drawGlow({ active, camera, context, height, hovered, look, nodeColours, nodes, positions, surface, width, zoomScale })
  drawPulses({
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
  })

  // --- nodes, batched by colour -----------------------------------------------
  const batches = new Map<string, number[]>()
  /** Topics: the same colours, drawn hollow. */
  const hollowBatches = new Map<string, number[]>()
  for (let i = 0; i < nodes.length; i++) {
    if (i === active || i === hovered) continue
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale
    if (sx < -r || sy < -r || sx > width + r || sy > height + r) continue
    const colour = nodeColours[i] ?? surface.node
    const target = nodes[i]?.topic === true ? hollowBatches : batches
    let batch = target.get(colour)
    if (batch === undefined) {
      batch = []
      target.set(colour, batch)
    }
    batch.push(sx, sy, r)
  }

  const ring = look.node.shape === 'ring'
  const paint = (colour: string, coords: number[], alpha: number, hollow = false): void => {
    context.globalAlpha = alpha
    context.beginPath()
    for (let i = 0; i < coords.length; i += 3) {
      const x = coords[i]!
      const y = coords[i + 1]!
      const r = coords[i + 2]!
      context.moveTo(x + r, y)
      context.arc(x, y, r, 0, Math.PI * 2)
    }
    if (ring || hollow) {
      context.strokeStyle = colour
      context.lineWidth = Math.max(1, 1.4 * zoomScale)
      context.stroke()
    } else {
      context.fillStyle = colour
      context.fill()
    }
  }
  for (const [colour, coords] of batches) paint(colour, coords, look.node.opacity)
  for (const [colour, coords] of hollowBatches) paint(colour, coords, look.node.opacity, true)

  // Hovered and open notes last, on top of everything.
  const single = (i: number, isActive: boolean): void => {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale
    if (sx < -r * 2 || sy < -r * 2 || sx > width + r * 2 || sy > height + r * 2) return
    const colour = isActive ? palette.nodeActive : (nodeColours[i] ?? surface.node)
    paint(colour, [sx, sy, isActive ? r * 1.6 : r * 1.25], 1, nodes[i]?.topic === true)
    // A ring around the open note, so it reads even against a dense cluster.
    if (isActive) {
      context.globalAlpha = 0.35
      context.strokeStyle = palette.nodeActive
      context.lineWidth = 2
      context.beginPath()
      context.arc(sx, sy, r * 1.6 + 5, 0, Math.PI * 2)
      context.stroke()
    }
  }
  if (hovered >= 0 && hovered !== active && hovered < nodes.length) single(hovered, false)
  if (active >= 0 && active < nodes.length) single(active, true)

  /*
   * The veil: paint the ground back over everything, then put the
   * neighbourhood on top of it.
   *
   * Drawn as one rectangle rather than by dimming each batch, because the
   * edges, their arrows, their pulses and the labels all have their own alphas
   * and would each need the same rule applied by hand - and any one of them
   * missed reads as a bug. One cover, then redraw what should stay lit.
   */
  const focus = state.focus ?? null
  const focusFade = Math.max(0, Math.min(1, state.focusFade ?? 1))
  drawVeil({
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
  })
  drawLabels({
    active,
    camera,
    context,
    focus,
    focusFade,
    height,
    hovered,
    look,
    neighbours,
    nodes,
    palette,
    positions,
    state,
    surface,
    width,
    zoomScale,
  })

  context.globalAlpha = 1
  return performance.now() - started
}
