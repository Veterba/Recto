import { describe, expect, it } from 'vitest'
import { mergeLines } from '../../src/shared/line-merge'

/** Typing and another app's write, from the same saved text: both kept when they are on different lines. */

const base = ['# Plan', '', 'First.', 'Second.', 'Third.', ''].join('\n')

describe('merging two sides of a note by lines', () => {
  it('changes on different lines are both kept', () => {
    const typed = base.replace('First.', 'First, typed here.')
    const synced = base.replace('Third.', 'Third, from the phone.')
    expect(mergeLines(base, typed, synced)).toBe(['# Plan', '', 'First, typed here.', 'Second.', 'Third, from the phone.', ''].join('\n'))
  })

  it('a line added at the end and an edit near the top: both', () => {
    const typed = `${base}A new last line.`
    const synced = base.replace('# Plan', '# The plan')
    expect(mergeLines(base, typed, synced)).toBe(['# The plan', '', 'First.', 'Second.', 'Third.', 'A new last line.'].join('\n'))
  })

  it('the same line changed on both sides: a conflict, for the caller to settle', () => {
    expect(mergeLines(base, base.replace('Second.', 'Mine.'), base.replace('Second.', 'Theirs.'))).toBeNull()
    // Both inserting at one place.
    expect(mergeLines(base, base.replace('Second.', 'Second.\nMine.'), base.replace('Second.', 'Second.\nTheirs.'))).toBeNull()
  })

  it('one side unchanged takes the other; the same change on both sides is made once', () => {
    const typed = base.replace('First.', 'One.')
    expect(mergeLines(base, typed, base)).toBe(typed)
    expect(mergeLines(base, base, typed)).toBe(typed)
    expect(mergeLines(base, typed, typed)).toBe(typed)
    expect(mergeLines(base, `${typed}x`, typed)).toBe(`${typed}x`)
  })
})
