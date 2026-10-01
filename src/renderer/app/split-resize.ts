/**
 * Where a split's divider goes when it is dragged: pure arithmetic.
 *
 * The divider's new place is worked out from where the pointer is now, in the
 * split container's own coordinates - never by adding up how far it moved
 * since last time, which compounds: every move re-added the distance already
 * applied, and the divider raced to one end. Only the two panes either side
 * of the divider change; each keeps at least `minPx`.
 */

/** No pane dragged narrower (or, stacked, shorter) than this. */
export const MIN_PANE_PX = 280

/** Where the divider after pane `index` sits, in px from the container's start. */
export function boundaryOf(sizes: readonly number[], index: number, total: number): number {
  let at = 0
  for (let i = 0; i <= index; i++) at += (sizes[i] ?? 0) * total
  return at
}

/**
 * The sizes with the divider after pane `index` moved to `boundaryPx`.
 *
 * Clamped so both panes keep `minPx`. When the two together are too small for
 * that - a window squeezed narrow - the divider holds the middle of them
 * rather than letting either collapse.
 */
export function resizeSplit({
  sizes,
  index,
  total,
  boundaryPx,
  minPx = MIN_PANE_PX,
}: {
  sizes: readonly number[]
  index: number
  total: number
  boundaryPx: number
  minPx?: number
}): number[] {
  if (total <= 0 || index < 0 || index >= sizes.length - 1) return [...sizes]
  const start = boundaryOf(sizes, index - 1, total)
  const pair = ((sizes[index] ?? 0) + (sizes[index + 1] ?? 0)) * total
  const first = pair < 2 * minPx ? pair / 2 : Math.min(pair - minPx, Math.max(minPx, boundaryPx - start))
  const next = [...sizes]
  next[index] = first / total
  next[index + 1] = (pair - first) / total
  return next
}

/** The two panes either side of divider `index` set to share their room equally. */
export function evenPair(sizes: readonly number[], index: number): number[] {
  if (index < 0 || index >= sizes.length - 1) return [...sizes]
  const half = ((sizes[index] ?? 0) + (sizes[index + 1] ?? 0)) / 2
  const next = [...sizes]
  next[index] = half
  next[index + 1] = half
  return next
}
