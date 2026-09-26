/**
 * Screen and world coordinates, hit-testing and framing for the graph.
 */

import { nodeRadius, type GraphLook, DEFAULT_LOOK } from './look'
import type { Camera, RenderState } from './render-state'

/** Node radius with the default look. Kept for callers that have no look. */
export const radiusOf = (degree: number): number => nodeRadius(degree)

export const radiusIn = (look: GraphLook, degree: number): number => nodeRadius(degree, look.node.size, look.node.growth)

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
