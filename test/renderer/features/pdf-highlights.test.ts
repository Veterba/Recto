import { describe, expect, it } from 'vitest'
import { rectsOn } from '../../../src/renderer/features/pdf/pdf-highlights'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

describe('PDF highlights', () => {
  it('a selection’s pieces on a page are kept as fractions of the page, so they sit right at any size', () => {
    const page = rect(100, 200, 400, 800)
    expect(rectsOn(page, [rect(140, 280, 100, 20)])).toEqual([{ x: 0.1, y: 0.1, w: 0.25, h: 0.025 }])
  })
  it('pieces off the page or with no size are left out', () => {
    const page = rect(0, 0, 100, 100)
    expect(rectsOn(page, [rect(200, 10, 10, 10), rect(10, 10, 0, 10)])).toEqual([])
  })
})
