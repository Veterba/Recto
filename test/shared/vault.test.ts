import { describe, expect, it } from 'vitest'
import { isHidden, nameOf, parentOf, sortNodes, type FileNode } from '../../src/shared/vault'

describe('vault paths', () => {
  it('splits a path into its folder and its name', () => {
    expect(parentOf('a/b/c.md')).toBe('a/b')
    expect(nameOf('a/b/c.md')).toBe('c.md')
  })

  it('treats a root-level path as having no folder', () => {
    expect(parentOf('c.md')).toBe('')
    expect(nameOf('c.md')).toBe('c.md')
  })
})

describe('hidden names', () => {
  it('hides the app state, VCS, OS litter and dotfiles', () => {
    for (const name of ['.recto', '.git', '.DS_Store', 'node_modules', '.trash', '.obsidian']) expect(isHidden(name)).toBe(true)
  })

  it('shows everything else', () => {
    for (const name of ['notes', 'a.md', 'attachments']) expect(isHidden(name)).toBe(false)
  })
})

describe('sorting tree nodes', () => {
  const file = (name: string): FileNode => ({ path: name, name, kind: 'file' })
  const folder = (name: string): FileNode => ({ path: name, name, kind: 'folder', children: [] })

  it('puts folders first, then sorts by name, numbers by value and ignoring case', () => {
    const sorted = sortNodes([file('b.md'), folder('Z'), file('note 10.md'), file('A.md'), folder('a'), file('note 9.md')])
    expect(sorted.map((n) => n.name)).toEqual(['a', 'Z', 'A.md', 'b.md', 'note 9.md', 'note 10.md'])
  })

  it('returns a new array and leaves the input alone', () => {
    const input = [file('b.md'), file('a.md')]
    const sorted = sortNodes(input)
    expect(sorted).not.toBe(input)
    expect(input.map((n) => n.name)).toEqual(['b.md', 'a.md'])
  })
})
