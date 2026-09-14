import { screenToWorld, type Camera } from './renderer'

/**
 * Smooth camera movement for the graph: eased zoom, eased jumps, and a pan
 * that glides to a stop after you let go.
 *
 * The camera the renderer draws is always chasing a TARGET. Input moves the
 * target; each frame moves the camera a fraction of the remaining way. That one
 * rule is what makes a scroll wheel's coarse steps, a trackpad's stream of tiny
 * ones and a "centre on note" jump all feel like the same continuous motion.
 *
 * Pure, and frame-rate independent: every step is scaled by the real time since
 * the last frame, so a 120 Hz display does not move twice as fast as a 60 Hz one.
 */

export type ZoomAnchor = { sx: number; sy: number; wx: number; wy: number }

export type Motion = {
  target: Camera
  /**
   * While a zoom is animating, the world point that must stay under the
   * pointer. Easing zoom and position separately lets that point slide around
   * mid-animation; deriving position from the anchor at every frame keeps it
   * pinned the whole way, not just at the end.
   */
  anchor: ZoomAnchor | null
  /** Glide after a pan, in world units per millisecond. */
  velocity: { x: number; y: number }
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 6

/** Fraction of the remaining distance covered per 60 Hz frame. */
const EASE = 0.22
/** How much of the glide survives each 60 Hz frame. */
const FRICTION = 0.9
const FRAME = 1000 / 60

export const still = (camera: Camera): Motion => ({ target: { ...camera }, anchor: null, velocity: { x: 0, y: 0 } })

/**
 * Zoom by `factor` about a screen point, updating the target.
 *
 * Built on the current TARGET, not the drawn camera, so a burst of wheel events
 * accumulates into one smooth zoom instead of each event restarting from
 * wherever the animation happened to be.
 */
export function zoomAt(motion: Motion, sx: number, sy: number, factor: number, width: number, height: number): Motion {
  const from = motion.target
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.zoom * factor))
  const [wx, wy] = screenToWorld(from, sx, sy, width, height)
  return {
    target: { zoom, x: wx - (sx - width / 2) / zoom, y: wy - (sy - height / 2) / zoom },
    anchor: { sx, sy, wx, wy },
    velocity: { x: 0, y: 0 },
  }
}

/** Advance the camera toward the target by `dt` milliseconds. */
export function step(
  camera: Camera,
  motion: Motion,
  dt: number,
  width: number,
  height: number,
  reducedMotion = false,
): { camera: Camera; motion: Motion; moving: boolean } {
  const frames = Math.min(4, Math.max(0, dt) / FRAME)
  let target = motion.target
  let velocity = motion.velocity
  let { x, y, zoom } = camera

  // --- glide -------------------------------------------------------------------
  const gliding = !reducedMotion && Math.abs(velocity.x) + Math.abs(velocity.y) > 1e-4
  if (gliding) {
    const dx = velocity.x * dt
    const dy = velocity.y * dt
    target = { ...target, x: target.x + dx, y: target.y + dy }
    x += dx
    y += dy
    const keep = Math.pow(FRICTION, frames)
    velocity = { x: velocity.x * keep, y: velocity.y * keep }
  } else {
    velocity = { x: 0, y: 0 }
  }

  // --- ease toward the target ---------------------------------------------------
  const k = reducedMotion ? 1 : 1 - Math.pow(1 - EASE, frames)
  zoom = Math.exp(Math.log(zoom) + (Math.log(target.zoom) - Math.log(zoom)) * k)
  if (motion.anchor !== null) {
    x = motion.anchor.wx - (motion.anchor.sx - width / 2) / zoom
    y = motion.anchor.wy - (motion.anchor.sy - height / 2) / zoom
  } else {
    x += (target.x - x) * k
    y += (target.y - y) * k
  }

  // --- arrived? ------------------------------------------------------------------
  const close =
    Math.abs(target.zoom - zoom) / target.zoom < 1e-3 &&
    Math.abs(target.x - x) * zoom < 0.25 &&
    Math.abs(target.y - y) * zoom < 0.25
  const stopped = Math.abs(velocity.x) + Math.abs(velocity.y) <= 1e-4
  if (close && stopped) {
    return { camera: { ...target }, motion: { target, anchor: null, velocity: { x: 0, y: 0 } }, moving: false }
  }
  return { camera: { x, y, zoom }, motion: { target, anchor: motion.anchor, velocity }, moving: true }
}
