import { describe, expect, it } from 'vitest'
import { highlightParts, matchesQuery } from '../../../src/renderer/ui/setting-search'

describe('settings search', () => {
  it('matches every word of the query anywhere in the text, ignoring case', () => {
    const text = 'Use a separate folder Its own folder, with its own year and month folders.'
    expect(matchesQuery(text, 'folder')).toBe(true)
    expect(matchesQuery(text, 'FOLDER year')).toBe(true)
    expect(matchesQuery(text, 'folder week')).toBe(false)
    expect(matchesQuery(text, '  ')).toBe(true)
  })

  it('marks each match, joining neighbours into one run', () => {
    expect(highlightParts('Month folders', 'folder')).toEqual([
      { text: 'Month ', hit: false },
      { text: 'folder', hit: true },
      { text: 's', hit: false },
    ])
    expect(highlightParts('Font size', 'font si')).toEqual([
      { text: 'Font', hit: true },
      { text: ' ', hit: false },
      { text: 'si', hit: true },
      { text: 'ze', hit: false },
    ])
    expect(highlightParts('Theme', '')).toEqual([{ text: 'Theme', hit: false }])
  })
})
