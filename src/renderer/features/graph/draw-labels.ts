/**
 * The graph's labels: culled by zoom and crowding, shortened to fit, and
 * faded out under the hover veil.
 */

import type { GraphLook } from './look'
import type { Palette } from './palette'
import type { RenderState } from './render-state'
import { worldToScreen, radiusIn } from './geometry'

/** Labels, culled by zoom and crowding, fading out under the veil. */
export function drawLabels({
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
}: {
  active: number
  camera: import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').Camera
  context: CanvasRenderingContext2D
  focus: ReadonlySet<number> | null
  focusFade: number
  height: number
  hovered: number
  look: GraphLook
  neighbours: ReadonlySet<number>
  nodes: readonly import('/Users/veterba/Documents/workplace/code/Recto/src/renderer/features/graph/render-state').GraphNodeView[]
  palette: Palette
  positions: Float32Array<ArrayBufferLike>
  state: RenderState
  surface: { dark: boolean; edge: string; node: string; orphan: string; label: string }
  width: number
  zoomScale: number
}): void {
  // --- labels, culled by zoom and crowding --------------------------------
  //
  // Text rendering is what actually kills naive graph views, not the physics.
  //
  // While the veil is up its own labels are the only text: these fade out as
  // it fades in, or every lit note would be named twice, a size apart.
  const veiled = focus !== null && focus.size > 0 ? focusFade : 0
  if (state.showLabels && veiled < 0.998) {
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
      context.globalAlpha = (isActive || isHovered ? 1 : 0.8 * fade) * (1 - veiled)
      context.fillStyle = isActive ? palette.labelActive : surface.label
      context.fillText(fitLabel(context, node.label, fontSize * 16), sx, sy + (isActive ? r * 1.6 : r) + 4)
    }
  }
}

/** Above this many nodes, only the better-connected ones get a label. */
const LABEL_CROWD_LIMIT = 120

const labelCache = new Map<string, string>()

/**
 * A label that fits `max` pixels, shortened with an ellipsis.
 *
 * `fillText`'s own max-width argument squeezes the glyphs horizontally to fit,
 * which at a large text size turned every long note name into condensed type.
 * Cut, never squeezed. Cached per font, since measuring text is the expensive
 * part of labels.
 */
export function fitLabel(context: CanvasRenderingContext2D, text: string, max: number): string {
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
