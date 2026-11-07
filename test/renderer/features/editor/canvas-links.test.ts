// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatLink, linkVault, resolveLinkpath, rewriteForRename } from '../../../../src/shared/obsidian-links'
import { linkKindOf } from '../../../../src/renderer/app/link-kinds'
import { linkEntries } from '../../../../src/renderer/features/file-tree/tree-lists'
import { LinkLabel } from '../../../../src/renderer/features/editor/live-preview-widgets'
import type { FileNode } from '../../../../src/shared/vault'

/**
 * Links to a canvas, as Obsidian has them: named by the file with `.canvas`
 * kept in the text, offered in the [[ list beside the notes, shown without
 * the extension, followed whether or not they carry an alias, and rewritten
 * in both forms when the canvas is renamed.
 */

const MAP = 'Recto/Canvas/Japan moodboard.canvas'
const files = [
  { path: 'Projects/Japan trip/Japan trip plan.md', ctime: 1 },
  { path: 'Projects/Japan trip/Kyoto.md', ctime: 2 },
  { path: MAP, ctime: 3 },
]
const vault = linkVault(files)

describe('canvas links', () => {
  it('resolve by the file name with .canvas, not by the bare name', () => {
    expect(resolveLinkpath('Japan moodboard.canvas', 'Projects/Japan trip/Japan trip plan.md', vault)).toBe(MAP)
    expect(resolveLinkpath('Recto/Canvas/Japan moodboard.canvas', '', vault)).toBe(MAP)
    // Obsidian does not find a canvas from its name alone either.
    expect(resolveLinkpath('Japan moodboard', 'Projects/Japan trip/Japan trip plan.md', vault)).toBeNull()
  })

  it('are written with .canvas kept, in each new-link format', () => {
    const source = 'Projects/Japan trip/Japan trip plan.md'
    const write = (format: 'shortest' | 'relative' | 'absolute'): string => formatLink(MAP, source, vault, { newLinkFormat: format, useMarkdownLinks: false })
    expect(write('shortest')).toBe('[[Japan moodboard.canvas]]')
    expect(write('relative')).toBe('[[../../Recto/Canvas/Japan moodboard.canvas]]')
    expect(write('absolute')).toBe('[[Recto/Canvas/Japan moodboard.canvas]]')
  })

  it('a rename updates the link, with and without an alias', () => {
    const text = 'See [[Japan moodboard.canvas]] and [[Japan moodboard.canvas|the moodboard]].'
    const moved = 'Recto/Canvas/Japan pictures.canvas'
    const after = linkVault(files.map((f) => (f.path === MAP ? { ...f, path: moved } : f)))
    const result = rewriteForRename(
      text,
      { before: 'Projects/Japan trip/Japan trip plan.md', after: 'Projects/Japan trip/Japan trip plan.md' },
      new Map([[MAP, moved]]),
      vault,
      after,
      { newLinkFormat: 'shortest' },
    )
    expect(result.text).toBe('See [[Japan pictures.canvas]] and [[Japan pictures.canvas|the moodboard]].')
    expect(result.changed).toBe(2)
  })

  it('are offered in the [[ list beside the notes, named without .canvas, with the canvas icon', () => {
    const roots: FileNode[] = [
      { kind: 'folder', name: 'Projects', path: 'Projects', children: [{ kind: 'file', name: 'Kyoto.md', path: 'Projects/Kyoto.md' }] },
      {
        kind: 'folder',
        name: 'Recto',
        path: 'Recto',
        children: [{ kind: 'folder', name: 'Canvas', path: 'Recto/Canvas', children: [{ kind: 'file', name: 'Japan moodboard.canvas', path: MAP }] }],
      },
      { kind: 'file', name: 'photo.png', path: 'photo.png' },
    ] as FileNode[]
    expect(linkEntries(roots)).toEqual([
      { path: 'Projects/Kyoto.md', name: 'Kyoto', folder: 'Projects' },
      { path: MAP, name: 'Japan moodboard', folder: 'Recto/Canvas' },
    ])
    expect(linkKindOf(MAP)).toBe('canvas')
    expect(linkKindOf('Japan moodboard.canvas')).toBe('canvas')
  })

  it('show the alias or the name, and carry where they go for the click, ⌘-click and hover', () => {
    const plain = new LinkLabel('Japan moodboard', false, 'canvas', 'Japan moodboard.canvas').toDOM()
    expect(plain.textContent).toBe('Japan moodboard')
    expect(plain.dataset['target']).toBe('Japan moodboard.canvas')
    expect(plain.querySelector('.cm-link-icon--canvas')).not.toBeNull()
    const aliased = new LinkLabel('the moodboard', false, 'canvas', 'Japan moodboard.canvas').toDOM()
    expect(aliased.textContent).toBe('the moodboard')
    expect(aliased.dataset['target']).toBe('Japan moodboard.canvas')
  })
})
