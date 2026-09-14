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
 * Everything colour-related is read from the CSS tokens, so the graph follows
 * the app's theme and accent with no second palette.
 */

export type GraphNodeView = {
  path: string
  label: string
  degree: number
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
}

/** Below this zoom, labels are unreadable and cost more than they convey. */
const LABEL_MIN_ZOOM = 0.55
/** Above this many nodes, only the better-connected ones get a label. */
const LABEL_CROWD_LIMIT = 120

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
}

export function readPalette(): Palette {
  const accent = css('--accent', '#8b7cf8')
  return {
    edge: css('--border-strong', '#3d3d48'),
    edgeActive: accent,
    node: css('--text-muted', '#6f6f7d'),
    nodeActive: accent,
    nodeOrphan: css('--border', '#2e2e37'),
    label: css('--text-secondary', '#a6a6b2'),
    labelActive: accent,
  }
}

/** Node radius grows with degree but flattens, or hubs become blobs. */
export const radiusOf = (degree: number): number => 3 + Math.min(7, Math.sqrt(degree) * 2.2)

export function worldToScreen(camera: Camera, x: number, y: number, width: number, height: number): [number, number] {
  return [(x - camera.x) * camera.zoom + width / 2, (y - camera.y) * camera.zoom + height / 2]
}

export function screenToWorld(camera: Camera, x: number, y: number, width: number, height: number): [number, number] {
  return [(x - width / 2) / camera.zoom + camera.x, (y - height / 2) / camera.zoom + camera.y]
}

/** Nearest node within `slack` screen pixels, or -1. */
export function pick(state: RenderState, screenX: number, screenY: number, width: number, height: number, slack = 6): number {
  const { positions, camera } = state
  let best = -1
  let bestDistance = Infinity

  for (let i = 0; i < state.nodes.length; i++) {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusOf(state.nodes[i]?.degree ?? 0) * camera.zoom + slack
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
  const zoom = Math.min(2, Math.min((width - 80) / spanX, (height - 80) / spanY))

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(0.08, zoom) }
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

  // --- edges, batched into as few paths as possible -----------------------
  //
  // One path per visual style rather than per edge: a stroke() call per edge is
  // what makes naive canvas graphs slow, not the geometry.
  const plain: number[] = []
  const lit: number[] = []

  for (const [a, b] of edges) {
    const isLit = highlighting && (a === active || b === active)
    const target = isLit ? lit : plain
    const [x1, y1] = worldToScreen(camera, positions[a * 2] ?? 0, positions[a * 2 + 1] ?? 0, width, height)
    const [x2, y2] = worldToScreen(camera, positions[b * 2] ?? 0, positions[b * 2 + 1] ?? 0, width, height)
    // Cheap off-screen rejection; a line fully outside cannot contribute.
    if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > width && x2 > width) || (y1 > height && y2 > height)) {
      continue
    }
    target.push(x1, y1, x2, y2)
  }

  const strokeBatch = (coords: number[], colour: string, alpha: number, lineWidth: number): void => {
    if (coords.length === 0) return
    context.globalAlpha = alpha
    context.strokeStyle = colour
    context.lineWidth = lineWidth
    context.beginPath()
    for (let i = 0; i < coords.length; i += 4) {
      context.moveTo(coords[i] ?? 0, coords[i + 1] ?? 0)
      context.lineTo(coords[i + 2] ?? 0, coords[i + 3] ?? 0)
    }
    context.stroke()
  }

  strokeBatch(plain, palette.edge, 0.55, 1)
  strokeBatch(lit, palette.edgeActive, 0.9, 1.5)

  // --- nodes --------------------------------------------------------------
  for (let i = 0; i < nodes.length; i++) {
    const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
    const r = radiusOf(nodes[i]?.degree ?? 0) * Math.max(0.6, Math.min(1.6, camera.zoom))
    if (sx < -r || sy < -r || sx > width + r || sy > height + r) continue

    const isActive = i === active
    const isNeighbour = neighbours.has(i)
    const isHovered = i === hovered

    context.globalAlpha = 1
    context.fillStyle = isActive
      ? palette.nodeActive
      : (nodes[i]?.degree ?? 0) === 0
        ? palette.nodeOrphan
        : palette.node

    context.beginPath()
    context.arc(sx, sy, isActive ? r * 1.6 : isHovered ? r * 1.25 : r, 0, Math.PI * 2)
    context.fill()

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

  // --- labels, culled by zoom and crowding --------------------------------
  //
  // Text rendering is what actually kills naive graph views, not the physics.
  if (state.showLabels) {
    context.font = `${Math.max(9, Math.min(13, 11 * camera.zoom))}px -apple-system, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'top'

    const crowded = nodes.length > LABEL_CROWD_LIMIT
    const minDegree = crowded ? Math.max(1, Math.floor(Math.log2(nodes.length))) : 0

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (node === undefined) continue

      const isActive = i === active
      const isHovered = i === hovered
      const isNeighbour = neighbours.has(i)

      // The open note and whatever is under the cursor are always labelled,
      // whatever the zoom - that is the point of the highlight.
      if (!isActive && !isHovered) {
        if (camera.zoom < LABEL_MIN_ZOOM) continue
        if (node.degree < minDegree && !isNeighbour) continue
      }

      const [sx, sy] = worldToScreen(camera, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, width, height)
      if (sx < 0 || sy < 0 || sx > width || sy > height) continue

      const r = radiusOf(node.degree) * Math.max(0.6, Math.min(1.6, camera.zoom))
      context.globalAlpha = isActive || isHovered ? 1 : 0.8
      context.fillStyle = isActive ? palette.labelActive : palette.label
      context.fillText(node.label, sx, sy + (isActive ? r * 1.6 : r) + 4, 160)
    }
  }

  context.globalAlpha = 1
  return performance.now() - started
}
