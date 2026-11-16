import { describe, expect, it } from 'vitest'
import { blankRows, mostlyOneColour } from '../../src/main/picture-checks'

/** A picture `width`×`height`, each pixel's colour from `paint`. */
function bitmap(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out.set([...paint(x, y), 255], (y * width + x) * 4)
  return out
}

describe('mostlyOneColour', () => {
  it('a name on a plain ground is a logo', () => {
    // The Verge's: white letters across the middle of a purple ground.
    const logo = bitmap(48, 25, (x, y) => (y > 9 && y < 15 && x % 3 === 0 ? [255, 255, 255] : [87, 0, 255]))
    expect(mostlyOneColour(logo)).toBe(true)
  })
  it('a photo is not', () => {
    const photo = bitmap(48, 25, (x, y) => [(x * 5) % 256, (y * 9) % 256, (x * y) % 256])
    expect(mostlyOneColour(photo)).toBe(false)
  })
  it('a ground a little uneven (a JPEG) still counts as one colour', () => {
    const noisy = bitmap(48, 25, (x) => [87 + (x % 3), 1, 250 + (x % 2)])
    expect(mostlyOneColour(noisy)).toBe(true)
  })
})

describe('blankRows', () => {
  it('counts the empty rows above what the page shows', () => {
    const page = bitmap(64, 36, (x, y) => (y < 7 ? [245, 245, 245] : [x * 4, y * 7, 0]))
    expect(blankRows(page, 64, 36)).toBe(7)
  })
  it('none when the page starts at the top', () => {
    const page = bitmap(64, 36, (x, y) => [x * 4, y * 7, 0])
    expect(blankRows(page, 64, 36)).toBe(0)
  })
  it('a third at most: a page blank all the way down is not cut away', () => {
    const blank = bitmap(64, 36, () => [255, 255, 255])
    expect(blankRows(blank, 64, 36)).toBe(12)
  })
})
