/**
 * The slide between the overlay's two pages: how long it takes and its curve.
 */

/** How long the pages take to change places, and the curve they do it on. */
export const SLIDE_MS = 520

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)`, solved.
 *
 * The DOM slide and the shader slide have to be the same number on the same
 * frame, which rules out letting CSS animate one of them: a transition runs on
 * the compositor's clock and lands wherever it likes relative to a rAF tick.
 * So the curve is evaluated here and written to both.
 */
export function ease(t: number): number {
  const x1 = 0.16
  const x2 = 0.3
  const y1 = 1
  const y2 = 1
  const cx = (u: number): number => ((1 - 3 * x2 + 3 * x1) * u + (3 * x2 - 6 * x1)) * u * u + 3 * x1 * u
  const dx = (u: number): number => 3 * (1 - 3 * x2 + 3 * x1) * u * u + 2 * (3 * x2 - 6 * x1) * u + 3 * x1
  let u = t
  for (let i = 0; i < 6; i++) {
    const slope = dx(u)
    if (Math.abs(slope) < 1e-6) break
    u -= (cx(u) - t) / slope
  }
  u = Math.max(0, Math.min(1, u))
  return ((1 - 3 * y2 + 3 * y1) * u + (3 * y2 - 6 * y1)) * u * u + 3 * y1 * u
}
