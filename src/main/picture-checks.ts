/**
 * What a link card's picture is, judged from its pixels (BGRA or RGBA - the
 * order of the colours does not matter here), looked at small.
 */

/** Mostly one colour: a site's name on a plain ground - a logo, not a picture of the page. */
export function mostlyOneColour(bitmap: Uint8Array): boolean {
  const counts = new Map<number, number>()
  let most = 0
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    // Colours a little rounded: a logo's ground is one colour give or take.
    const key = ((bitmap[i]! >> 4) << 8) | ((bitmap[i + 1]! >> 4) << 4) | (bitmap[i + 2]! >> 4)
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    if (n > most) most = n
  }
  return most > bitmap.length / 4 / 2
}

/**
 * How many rows at the top are blank (every pixel close to the row's first),
 * a third of the height at most: an ad's empty slot, a banner's gap.
 */
export function blankRows(bitmap: Uint8Array, width: number, height: number): number {
  let row = 0
  for (; row < height / 3; row++) {
    const at = row * width * 4
    let blank = true
    for (let x = 1; x < width && blank; x++)
      for (let c = 0; c < 3; c++) if (Math.abs(bitmap[at + x * 4 + c]! - bitmap[at + c]!) > 12) blank = false
    if (!blank) break
  }
  return row
}
