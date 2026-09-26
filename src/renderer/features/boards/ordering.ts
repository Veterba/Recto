/**
 * Fractional indexing for card order.
 *
 * Dropping a card between two others writes ONE number into ONE file. The
 * alternative - numbering a column 1..n - rewrites every note in that column on
 * every drag, which for a file-backed board means n file writes, n watcher
 * events and n index updates for one gesture.
 *
 * The catch nobody mentions is that halving a gap is not free forever: a double
 * has ~52 bits of mantissa, so repeatedly dropping into the same gap exhausts
 * the space in about fifty drags and two cards end up with the same order. This
 * module owns that problem rather than pretending it does not exist - when the
 * gap gets too small, the caller is told to renumber that one column.
 */

/** Below this gap, halving is close enough to the limit to stop trusting it. */
export const MIN_GAP = 1e-6

/** The step used when appending past the end, and when renumbering. */
export const STEP = 1

export type Placement =
  | { kind: 'order'; order: number }
  /** The gap is exhausted; write these orders across the whole column. */
  | { kind: 'renumber'; orders: number[] }

/**
 * Where a card lands when dropped at `index` in a column whose current orders
 * are `column` (ascending, the moved card already removed).
 *
 * `index` is the slot the card takes: 0 is the top, `column.length` the bottom.
 */
export function placeAt(column: readonly number[], index: number): Placement {
  const before = column[index - 1]
  const after = column[index]

  if (before === undefined && after === undefined) return { kind: 'order', order: STEP }
  if (before === undefined) return { kind: 'order', order: after! - STEP }
  if (after === undefined) return { kind: 'order', order: before + STEP }

  if (after - before < MIN_GAP) {
    // Renumber the column including the slot the new card will occupy, and
    // hand back the whole sequence; the caller writes them all.
    const orders = Array.from({ length: column.length + 1 }, (_, i) => (i + 1) * STEP)
    return { kind: 'renumber', orders }
  }

  return { kind: 'order', order: (before + after) / 2 }
}

/**
 * Cards in a column, in the order they should be drawn.
 *
 * A card with no `order` has never been dragged - it was written by hand, or
 * created outside the board. Those sort last, by title, so they have a stable
 * home instead of jumping around whenever the list is rebuilt.
 */
export function sortColumn<T extends { order: number | null; title: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.order === null && b.order === null) return a.title.localeCompare(b.title)
    if (a.order === null) return 1
    if (b.order === null) return -1
    if (a.order !== b.order) return a.order - b.order
    // Ties happen after a hand-edit of two files to the same number. Falling
    // back to the title keeps the board from flickering between two orders.
    return a.title.localeCompare(b.title)
  })
}
