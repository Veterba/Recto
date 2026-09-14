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

import {
  averageColor,
  COLOR_STEPS,
  DEFAULT_LOOK,
  degreeT,
  groupColor,
  nodeRadius,
  paintSteps,
  parseHex,
  withAlpha,
  type GraphLook,
} from './look'

export type GraphNodeView = {
  path: string
  label: string
  degree: number
  /** Top-level folder, as an index - for colouring by folder. */
  group?: number
}

export type Camera = { x: number; y: number; zoom: number }

export type RenderState = {
  nodes: readonly GraphNodeView[]
  /** Index pairs into `nodes`. */
  edges: readonly [number, number][]
  positions: Float32Array
  /** Index of the note currently open, or -1. */
  active: number
  /** Indices one hop from the active note. */
  neighbours: ReadonlySet<number>
  hovered: number
  camera: Camera
  showLabels: boolean
  look?: GraphLook
  /** Milliseconds, for anything that moves on its own (pulses). */
  time?: number
  /**
   * In a tree layout: which links are the tree's own, by edge index, and which
   * way it grows. Tree links are drawn as smooth branches; the rest - links
   * that close loops - faintly, or they cross the whole picture and hide it.
   */
  treeEdges?: ReadonlySet<number> | null
  treeDirection?: 'down' | 'up' | 'left' | 'right' | 'out' | null
  /** In the circle layout: bow every link toward the centre, like a chord diagram. */
  bundle?: boolean
}

/** Above this many nodes, only the better-connected ones get a label. */
const LABEL_CROWD_LIMIT = 120
/** Signals drawn at most per frame, however many links there are. */
const MAX_PULSES = 420

const css = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

export type Palette = {
  edge: string
  edgeActive: string
  node: string
  nodeActive: string
  nodeOrphan: string
  label: string
  labelActive: string
  /** Whether the app's own background is dark. */
  dark?: boolean
  /** The app's background, for working out what a tinted background comes to. */
  background?: string
}

/** Rough luminance of a CSS colour string, 0-1; unknown formats count as dark. */
function luminance(colour: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour)
  let rgb: number[] | null = null
  if (hex?.[1] !== undefined) rgb = [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
  const fn = /rgba?\(([^)]+)\)/.exec(colour)
  if (fn?.[1] !== undefined) rgb = fn[1].split(/[ ,/]+/).slice(0, 3).map(Number)
  if (rgb === null || rgb.some((v) => !Number.isFinite(v))) return 0
  return (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255
}

export function readPalette(): Palette {
  const accent = css('--accent', '#8b7cf8')
  return {
    edge: css('--border-strong', '#3d3d48'),
    edgeActive: accent,
    node: css('--text-muted', '#6f6f7d'),
    nodeActive: accent,
    // A step quieter than a linked note, not invisible: `--border` all but
    // vanished against the dark page, and a note you cannot see in the graph
    // reads as one the graph has lost.
    nodeOrphan: css('--border-strong', '#3d3d48'),
    label: css('--text-secondary', '#a6a6b2'),
    labelActive: accent,
    dark: luminance(css('--bg-primary', '#171717')) < 0.5,
    background: css('--bg-primary', '#171717'),
  }
}

/** Node radius with the default look. Kept for callers that have no look. */
export const radiusOf = (degree: number): number => nodeRadius(degree)

const radiusIn = (look: GraphLook, degree: number): number => nodeRadius(degree, look.node.size, look.node.growth)

export function worldToScreen(camera: Camera, x: number, y: number, width: number, height: number): [number, number] {
  return [(x - camera.x) * camera.zoom + width / 2, (y - camera.y) * camera.zoom + height / 2]
}

export function screenToWorld(camera: Camera, x: number, y: number, width: number, height: number): [number, number] {
  return [(x - width / 2) / camera.zoom + camera.x, (y - height / 2) / camera.zoom + camera.y]
}

/** Nearest node within `slack` screen pixels, or -1. */
export function pick(state: RenderState, screenX: number, screenY: number, width: number, height: number, slack = 6): number {
  const { positions, camera } = state
  const look = state.look ?? DEFAULT_LOOK
  let best = -1
  let bestDistance = Infinity

  for (let i = 0; i < state.nodes.length; i++) {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusIn(look, state.nodes[i]?.degree ?? 0) * camera.zoom + slack
    const dx = sx - screenX
    const dy = sy - screenY
    const distance = dx * dx + dy * dy
    if (distance <= r * r && distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}

/**
 * Is any node inside the viewport?
 *
 * Used after a resize. Shrinking the panel - maximise then restore, say - keeps
 * the camera it had at the larger size, which can leave every node outside the
 * frame and the graph looking empty and broken. Re-fitting only when *nothing*
 * is visible fixes that case without ever yanking the view away from someone
 * who has deliberately zoomed in on a cluster.
 */
export function anyVisible(state: RenderState, width: number, height: number): boolean {
  const { positions, camera, nodes } = state
  for (let i = 0; i < nodes.length; i++) {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) return true
  }
  return false
}

/** A camera that fits every node with a margin. */
export function fit(positions: Float32Array, count: number, width: number, height: number): Camera {
  if (count === 0) return { x: 0, y: 0, zoom: 1 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i++) {
    const x = positions[i * 2] ?? 0
    const y = positions[i * 2 + 1] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  // A small panel gets a small margin: 80px of a 300px floating graph was a
  // quarter of it spent on nothing.
  const margin = Math.min(80, Math.max(24, Math.min(width, height) * 0.08))
  const zoom = Math.min(2, Math.min((width - margin) / spanX, (height - margin) / spanY))

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(0.08, zoom) }
}

/** What the background implies for the colours drawn on it. */
type Surface = { dark: boolean; edge: string; node: string; orphan: string; label: string }

/**
 * The theme's colours - unless a tinted background has flipped how dark the
 * ground is. A deep navy wash over a light theme leaves the theme's dark grey
 * dots and labels unreadable, so the defaults follow the ground they sit on.
 */
export function surfaceFor(look: GraphLook, palette: Palette): Surface {
  const themeDark = palette.dark ?? true
  const tint = averageColor(look.background.colors)
  const base = parseHex(palette.background ?? '') ?? (themeDark ? [23, 23, 23] : [250, 250, 250])
  let dark = themeDark
  if (tint !== null) {
    const k = Math.min(100, Math.max(0, look.background.strength)) / 100
    const mixed = [0, 1, 2].map((i) => base[i]! * (1 - k) + tint[i]! * k)
    dark = (0.2126 * mixed[0]! + 0.7152 * mixed[1]! + 0.0722 * mixed[2]!) / 255 < 0.5
  }
  if (dark === themeDark) {
    return { dark, edge: palette.edge, node: palette.node, orphan: palette.nodeOrphan, label: palette.label }
  }
  // A tinted ground sits mid-way far more often than a theme does, so these
  // lean to contrast: a grey link that works on near-black vanishes on slate.
  return dark
    ? { dark, edge: '#cbd5e1', node: '#e2e8f0', orphan: '#94a3b8', label: 'rgba(241, 245, 249, 0.92)' }
    : { dark, edge: '#3f3f46', node: '#27272a', orphan: '#71717a', label: 'rgba(24, 24, 27, 0.9)' }
}

/** Soft round light, one per colour, drawn scaled - far cheaper than shadowBlur. */
const glowSprites = new Map<string, HTMLCanvasElement>()
function glowSprite(colour: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  // Theme colours arrive as whatever CSS the token holds - `hsl(...)`, a name.
  // The gradient's alpha stops need a hex, and without one every stop came out
  // opaque and the "glow" was a solid square.
  const hex = toHex(colour)
  if (hex === null) return null
  colour = hex
  let sprite = glowSprites.get(colour)
  if (sprite === undefined) {
    sprite = document.createElement('canvas')
    sprite.width = 64
    sprite.height = 64
    const g = sprite.getContext('2d')
    if (g === null) return null
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, withAlpha(colour, 0.9))
    gradient.addColorStop(0.25, withAlpha(colour, 0.45))
    gradient.addColorStop(1, withAlpha(colour, 0))
    g.fillStyle = gradient
    g.fillRect(0, 0, 64, 64)
    if (glowSprites.size > 256) glowSprites.clear()
    glowSprites.set(colour, sprite)
  }
  return sprite
}

let probe: CanvasRenderingContext2D | null = null
const hexCache = new Map<string, string | null>()

/** Any CSS colour as `#rrggbb`, via the canvas's own colour parser. Null if it cannot be read. */
function toHex(colour: string): string | null {
  if (parseHex(colour) !== null) return colour
  const cached = hexCache.get(colour)
  if (cached !== undefined) return cached
  probe ??= document.createElement('canvas').getContext('2d')
  let out: string | null = null
  if (probe !== null) {
    probe.fillStyle = '#000000'
    probe.fillStyle = colour
    const value = String(probe.fillStyle)
    if (value.startsWith('#')) out = value
    else {
      const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(',').map((v) => Number.parseFloat(v))
      if (parts !== undefined && parts.length >= 3) {
        out = `#${parts.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
      }
    }
  }
  hexCache.set(colour, out)
  return out
}

/** Colours cached per look, so a frame does not rebuild the gradient. */
let stepsFor: GraphLook['dots'] | null = null
let stepsBase = ''
let steps: string[] = []
let linkStepsFor: GraphLook['links'] | null = null
let linkStepsBase = ''
let linkSteps: string[] = []

/** Where along a link a point at `t` is, on the same curve the link is drawn with. */
function along(x1: number, y1: number, x2: number, y2: number, bend: number, t: number): [number, number] {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend
  const my = (y1 + y2) / 2 + (x2 - x1) * bend
  const u = 1 - t
  return [u * u * x1 + 2 * u * t * mx + t * t * x2, u * u * y1 + 2 * u * t * my + t * t * y2]
}

const labelCache = new Map<string, string>()

/**
 * A label that fits `max` pixels, shortened with an ellipsis.
 *
 * `fillText`'s own max-width argument squeezes the glyphs horizontally to fit,
 * which at a large text size turned every long note name into condensed type.
 * Cut, never squeezed. Cached per font, since measuring text is the expensive
 * part of labels.
 */
function fitLabel(context: CanvasRenderingContext2D, text: string, max: number): string {
  const key = `${context.font}|${max}|${text}`
  const cached = labelCache.get(key)
  if (cached !== undefined) return cached
  let out = text
  if (typeof context.measureText === 'function' && context.measureText(text).width > max) {
    let low = 0
    let high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (context.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= max) low = mid
      else high = mid - 1
    }
    out = `${text.slice(0, low).trimEnd()}…`
  }
  if (labelCache.size > 4000) labelCache.clear()
  labelCache.set(key, out)
  return out
}

/**
 * Draw one frame. Returns the time it took, so the UI can show it and so the
 * Canvas-vs-WebGL decision above can be revisited with numbers.
 */
export function draw(
  context: CanvasRenderingContext2D,
  state: RenderState,
  palette: Palette,
  width: number,
  height: number,
): number {
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
    if (highlighting && (a === active || b === active)) {
      lit.push(x1, y1, x2, y2)
      return
    }
    const colour = edgeColour(a, b)
    const target = state.treeEdges != null && !state.treeEdges.has(index) ? loops : plain
    let batch = target.get(colour)
    if (batch === undefined) {
      batch = []
      target.set(colour, batch)
    }
    batch.push(x1, y1, x2, y2)
  })

  const strokeBatch = (coords: number[], colour: string, alpha: number, lineWidth: number, branches = false): void => {
    if (coords.length === 0) return
    context.globalAlpha = alpha
    context.strokeStyle = colour
    context.lineWidth = lineWidth
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
  strokeBatch(lit, palette.edgeActive, Math.max(0.9, look.edge.opacity), edgeWidth + 0.5, flow !== null)

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
      batch.push(tipX, tipY, tipX - ux * size * 2 - uy * size, tipY - uy * size * 2 + ux * size, tipX - ux * size * 2 + uy * size, tipY - uy * size * 2 - ux * size)
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
      const colour = look.links.colors.length > 0 && !look.links.matchDots ? edgeColour(a, b) : (nodeColours[t < 0.5 ? a : b] ?? surface.node)
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

  // --- nodes, batched by colour -----------------------------------------------
  const batches = new Map<string, number[]>()
  for (let i = 0; i < nodes.length; i++) {
    if (i === active || i === hovered) continue
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale
    if (sx < -r || sy < -r || sx > width + r || sy > height + r) continue
    const colour = nodeColours[i] ?? surface.node
    let batch = batches.get(colour)
    if (batch === undefined) {
      batch = []
      batches.set(colour, batch)
    }
    batch.push(sx, sy, r)
  }

  const ring = look.node.shape === 'ring'
  const paint = (colour: string, coords: number[], alpha: number): void => {
    context.globalAlpha = alpha
    context.beginPath()
    for (let i = 0; i < coords.length; i += 3) {
      const x = coords[i]!
      const y = coords[i + 1]!
      const r = coords[i + 2]!
      context.moveTo(x + r, y)
      context.arc(x, y, r, 0, Math.PI * 2)
    }
    if (ring) {
      context.strokeStyle = colour
      context.lineWidth = Math.max(1, 1.4 * zoomScale)
      context.stroke()
    } else {
      context.fillStyle = colour
      context.fill()
    }
  }
  for (const [colour, coords] of batches) paint(colour, coords, look.node.opacity)

  // Hovered and open notes last, on top of everything.
  const single = (i: number, isActive: boolean): void => {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusIn(look, nodes[i]?.degree ?? 0) * zoomScale
    if (sx < -r * 2 || sy < -r * 2 || sx > width + r * 2 || sy > height + r * 2) return
    const colour = isActive ? palette.nodeActive : (nodeColours[i] ?? surface.node)
    paint(colour, [sx, sy, isActive ? r * 1.6 : r * 1.25], 1)
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

  // --- labels, culled by zoom and crowding --------------------------------
  //
  // Text rendering is what actually kills naive graph views, not the physics.
  if (state.showLabels) {
    const fontSize = look.label.size * Math.max(0.82, Math.min(1.2, camera.zoom))
    context.font = `${fontSize}px -apple-system, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'

    const crowded = nodes.length > LABEL_CROWD_LIMIT
    const scale = Math.max(1, Math.floor(Math.log2(Math.max(2, nodes.length))))
    const minDegree = [scale * 2, crowded ? scale : 0, crowded ? 1 : 0, 0][look.label.density] ?? 0
    // Labels fade in over a range of zoom instead of popping on at one value.
    const fade = Math.min(1, Math.max(0, (camera.zoom - look.label.fadeZoom) / (look.label.fadeZoom * 0.35)))

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (node === undefined) continue

      const isActive = i === active
      const isHovered = i === hovered
      const isNeighbour = neighbours.has(i)

      // The open note and whatever is under the cursor are always labelled,
      // whatever the zoom - that is the point of the highlight.
      if (!isActive && !isHovered) {
        if (fade <= 0) continue
        if (node.degree < minDegree && !isNeighbour) continue
      }

      const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
      if (sx < 0 || sy < 0 || sx > width || sy > height) continue

      const r = radiusIn(look, node.degree) * zoomScale
      context.globalAlpha = isActive || isHovered ? 1 : 0.8 * fade
      context.fillStyle = isActive ? palette.labelActive : surface.label
      context.fillText(fitLabel(context, node.label, fontSize * 16), sx, sy + (isActive ? r * 1.6 : r) + 4)
    }
  }

  context.globalAlpha = 1
  return performance.now() - started
}
