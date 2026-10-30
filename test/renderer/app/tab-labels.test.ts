import { describe, expect, it } from 'vitest'
import { folderHints, linkTo } from '../../../src/renderer/app/tab-labels'

describe('tab labels', () => {
  it('shows the parent folder only for tabs that share a name', () => {
    const hints = folderHints([
      { id: 'a', title: 'Ideas', path: 'Garden/Ideas.md' },
      { id: 'b', title: 'Ideas', path: 'Work/Kitchen/Ideas.md' },
      { id: 'c', title: 'Ideas', path: 'Ideas.md' },
      { id: 'd', title: 'Handbook', path: 'Handbook.md' },
      { id: 'e', title: 'Graph', path: null },
    ])
    expect(Object.fromEntries(hints)).toEqual({ a: 'Garden', b: 'Kitchen', c: '/' })
  })

  it('links a note by its name and any other file with its extension', () => {
    expect(linkTo('Garden/Ideas.md')).toBe('[[Ideas]]')
    expect(linkTo('Data/settings.json')).toBe('[[settings.json]]')
  })
})
