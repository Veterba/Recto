import { describe, expect, it } from 'vitest'
import { markdownTarget } from '../../src/shared/link-syntax'
import { parseKanban } from '../../src/shared/kanban'
import { linkVault, rewriteForRename } from '../../src/shared/obsidian-links'
import { extractTargets, parseNote } from '../../src/shared/parse'
import { rewriteWikiLinks } from '../../src/main/link-rewrite'

/** One way to read a link, wherever it is read: the index, a rename, a board. */

describe('a Markdown link target', () => {
  it.each([
    ['Old note.md', 'Old note.md', ''],
    ['Old%20note.md', 'Old note.md', ''],
    ['<Old note.md>', 'Old note.md', ''],
    ['<Old note.md> "A title"', 'Old note.md', ''],
    ['Old%20note.md#Part "A title"', 'Old note.md', '#Part'],
    ['Folder/Old note.md#^block', 'Folder/Old note.md', '#^block'],
  ])('%s is %s', (url, path, subpath) => {
    expect(markdownTarget(url)).toMatchObject({ path, subpath })
  })

  it.each(['https://example.com/a.md', 'mailto:a@b.c', '//host/a.md', '#Heading', ''])('%s is no file', (url) => {
    expect(markdownTarget(url)).toBeNull()
  })
})

describe('the escaped pipe of a link in a table', () => {
  const table = '| Note | Why |\n| --- | --- |\n| [[Plan\\|the plan]] | [[Plan#Steps\\|steps]] |'

  it('the index reads the link to Plan, with its alias and heading', () => {
    const links = parseNote(table).links.map((l) => ({ target: l.target, heading: l.heading, alias: l.alias }))
    expect(links).toEqual([
      { target: 'Plan', heading: null, alias: 'the plan' },
      { target: 'Plan', heading: 'Steps', alias: 'steps' },
    ])
    expect(extractTargets(table)).toEqual(['Plan'])
  })

  it('a rename rewrites it and keeps the escape', () => {
    const vault = (paths: string[]) => linkVault(paths.map((path) => ({ path, ctime: 0 })))
    const out = rewriteForRename(table, { before: 'Index.md', after: 'Index.md' }, new Map([['Plan.md', 'Roadmap.md']]), vault(['Index.md', 'Plan.md']), vault(['Index.md', 'Roadmap.md']), {
      newLinkFormat: 'shortest',
    })
    expect(out.text).toBe('| Note | Why |\n| --- | --- |\n| [[Roadmap\\|the plan]] | [[Roadmap#Steps\\|steps]] |')
    expect(out.changed).toBe(2)
  })

  it('a topic rename rewrites it too', () => {
    expect(rewriteWikiLinks('| [[topics/Plan\\|plan]] |', 'topics/Plan.md', 'topics/Roadmap.md', true).text).toBe('| [[topics/Roadmap\\|plan]] |')
  })
})

describe('a Markdown link a rename must follow', () => {
  const vault = (paths: string[]) => linkVault(paths.map((path) => ({ path, ctime: 0 })))
  const rename = (text: string) =>
    rewriteForRename(text, { before: 'Index.md', after: 'Index.md' }, new Map([['Old note.md', 'New note.md']]), vault(['Index.md', 'Old note.md']), vault(['Index.md', 'New note.md']), {
      newLinkFormat: 'shortest',
    }).text

  it.each(['[see](<Old note.md>)', '[see](Old%20note.md "A title")', '[see](Old note.md)'])('%s', (text) => {
    // Each is a link the index counts (parse.ts), so each is rewritten.
    expect(parseNote(text).links.map((l) => l.target)).toEqual(['Old note.md'])
    expect(rename(text)).toBe('[see](New%20note.md)')
  })
})

describe('a board card that is a Markdown link', () => {
  it('is a card for its note, as a wikilink card is', () => {
    const board = '---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] [Write it](Projects/Launch%20plan.md)\n- [ ] [[Projects/Launch plan]]\n- [ ] Just words\n- [ ] [Site](https://example.com)\n'
    expect(parseKanban(board).lanes[0]!.items.map((i) => i.link)).toEqual(['Projects/Launch plan', 'Projects/Launch plan', null, null])
  })
})
