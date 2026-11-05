/**
 * Snapping a dragged node to the others: when one of its edges or its centre
 * comes within a few pixels of another node's, it lines up exactly and a guide
 * is drawn along that line. Pure, so it is tested without a pointer.
 */

export type Box = { x: number; y: number; width: number; height: number }
/** A guide: a vertical line at `x`, or a horizontal one at `y`, in canvas units. */
export type Guide = { axis: 'x' | 'y'; at: number }

const lines = (start: number, size: number): number[] => [start, start + size / 2, start + size]

/**
 * Where `box` goes when let go here, and the guides to draw: nearest line on
 * each axis within `reach` (canvas units), or where it is.
 */
export function snapToOthers(box: Box, others: readonly Box[], reach: number): { x: number; y: number; guides: Guide[] } {
  let bestX: { delta: number; at: number } | null = null
  let bestY: { delta: number; at: number } | null = null
  const mineX = lines(box.x, box.width)
  const mineY = lines(box.y, box.height)
  for (const other of others) {
    for (const target of lines(other.x, other.width))
      for (const mine of mineX) {
        const delta = target - mine
        if (Math.abs(delta) <= reach && (bestX === null || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, at: target }
      }
    for (const target of lines(other.y, other.height))
      for (const mine of mineY) {
        const delta = target - mine
        if (Math.abs(delta) <= reach && (bestY === null || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, at: target }
      }
  }
  const guides: Guide[] = []
  if (bestX !== null) guides.push({ axis: 'x', at: bestX.at })
  if (bestY !== null) guides.push({ axis: 'y', at: bestY.at })
  return { x: box.x + (bestX?.delta ?? 0), y: box.y + (bestY?.delta ?? 0), guides }
}
