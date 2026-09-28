/**
 * Where a drop on a pane lands: pure geometry, no DOM.
 *
 * A pane is cut into five zones. The four edges each take a band a quarter of
 * the pane deep, split along the diagonals, and the rest is the centre. That
 * is "nearest edge, unless you are well inside" - the zone under the cursor is
 * the edge it is closest to, measured as a fraction of the pane so a wide pane
 * does not hand everything to top and bottom.
 */

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export type Rect = { left: number; top: number; width: number; height: number }

/** How deep an edge zone reaches, as a fraction of the pane. */
export const EDGE = 0.25

/** The zone at a point, or null when the point is outside the pane. */
export function zoneAt(rect: Rect, x: number, y: number, edge = EDGE): DropZone | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
  const distances: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ]
  let nearest = distances[0]!
  for (const entry of distances) if (entry[1] < nearest[1]) nearest = entry
  return nearest[1] < edge ? nearest[0] : 'center'
}

/** The area a drop in `zone` gives the new pane: half the pane, or all of it for the centre. */
export function zonePreview(rect: Rect, zone: DropZone): Rect {
  const { left, top, width, height } = rect
  switch (zone) {
    case 'left':
      return { left, top, width: width / 2, height }
    case 'right':
      return { left: left + width / 2, top, width: width / 2, height }
    case 'top':
      return { left, top, width, height: height / 2 }
    case 'bottom':
      return { left, top: top + height / 2, width, height: height / 2 }
    case 'center':
      return { ...rect }
  }
}
