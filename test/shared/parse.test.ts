import { describe, expect, it } from 'vitest'
import { extractTargets, parseNote } from '../../src/shared/parse'

describe('parsing a note', () => {
  it('splits frontmatter from body and types the values', () => {
    const note = parseNote(['---', 'title: Nordic Sync', 'order: 3', 'done: true', 'empty:', '---', '# Heading', 'body'].join('\n'))
    expect(note.frontmatter).toEqual({ title: 'Nordic Sync', order: 3, done: true, empty: null })
    expect(note.body).toBe('# Heading\nbody')
  })

  it('treats an unterminated frontmatter fence as body, not as metadata', () => {
    // A broken file must still be searchable rather than silently vanishing.
    const note = parseNote('---\ntitle: broken\n\n# still here')
    expect(note.frontmatter).toEqual({})
    expect(note.body).toContain('# still here')
  })

  it('prefers the frontmatter title, falling back to the first H1', () => {
    expect(parseNote('---\ntitle: From FM\n---\n# From H1').title).toBe('From FM')
    expect(parseNote('# From H1\n## not this').title).toBe('From H1')
    expect(parseNote('no headings here').title).toBeNull()
  })

  it('collects headings with level and line', () => {
    const note = parseNote('# One\ntext\n### Three')
    expect(note.headings).toEqual([
      { text: 'One', level: 1, line: 0 },
      { text: 'Three', level: 3, line: 2 },
    ])
  })

  it('parses every wikilink shape', () => {
    const note = parseNote('see [[note]] and [[other#Heading]] and [[third|an alias]] and [[a#H|b]]')
    expect(note.links).toEqual([
      { target: 'note', heading: null, alias: null, line: 0 },
      { target: 'other', heading: 'Heading', alias: null, line: 0 },
      { target: 'third', heading: null, alias: 'an alias', line: 0 },
      { target: 'a', heading: 'H', alias: 'b', line: 0 },
    ])
  })

  it('handles unicode link targets', () => {
    expect(parseNote('[[Заметки/день]]').links[0]?.target).toBe('Заметки/день')
  })

  it('finds unicode and nested tags, but not a heading', () => {
    const note = parseNote('# Not a tag\ntext #проект and #a/b')
    expect(note.tags.map((t) => t.tag)).toEqual(['проект', 'a/b'])
  })

  it('rejects a purely numeric tag, keeps an alphanumeric one', () => {
    // Obsidian's rule. It does mean '#ffcc00' counts as a tag - a hex colour in
    // prose is not distinguishable from one, and guessing would break real tags.
    const note = parseNote('#2026 and #w37 and #ffcc00')
    expect(note.tags.map((t) => t.tag)).toEqual(['w37', 'ffcc00'])
  })

  it('does not read the # inside a wikilink as a tag', () => {
    expect(parseNote('[[note#Section]]').tags).toEqual([])
  })

  it('ignores links and tags inside fenced code', () => {
    const note = parseNote(['text [[real]]', '```', '[[not-a-link]] #not-a-tag', '```', '#after'].join('\n'))
    expect(note.links.map((l) => l.target)).toEqual(['real'])
    expect(note.tags.map((t) => t.tag)).toEqual(['after'])
  })

  it('finds links inside heading text', () => {
    expect(parseNote('## see [[other]]').links.map((l) => l.target)).toEqual(['other'])
  })
})

describe('tags in properties', () => {
  const tagsOf = (yaml: string): [string, number][] => parseNote(`---\n${yaml}\n---\nBody #inline`).tags.map((t) => [t.tag, t.line])

  it('reads a bracket list, a comma list and a dash list, as Obsidian does, on their own lines', () => {
    expect(tagsOf('tags: [garden, herbs]')).toEqual([
      ['garden', 1],
      ['herbs', 1],
      ['inline', 3],
    ])
    expect(tagsOf('title: x\ntags: garden, "herbs"')).toEqual([
      ['garden', 2],
      ['herbs', 2],
      ['inline', 4],
    ])
    expect(tagsOf('tags:\n  - garden\n  - "#herbs"\nstatus: draft\n  - not-a-tag')).toEqual([
      ['garden', 2],
      ['herbs', 3],
      ['inline', 7],
    ])
  })

  it('takes the older `tag` key and a single value, and leaves other keys, empty lists and numbers alone', () => {
    expect(tagsOf('tag: video')).toEqual([
      ['video', 1],
      ['inline', 3],
    ])
    expect(tagsOf('tags: []\nkeywords: [garden]\ntags2: x')).toEqual([['inline', 5]])
    expect(tagsOf('tags: [2024, w37]')).toEqual([
      ['w37', 1],
      ['inline', 3],
    ])
  })
})

describe('links in frontmatter', () => {
  it('counts a link in a property, on its own line number', () => {
    const parsed = parseNote('---\nrelated: "[[Q4 plan]]"\nstatus: draft\n---\nBody with [[Other]].')
    expect(parsed.links.map((l) => [l.target, l.line])).toEqual([
      ['Q4 plan', 1],
      ['Other', 4],
    ])
  })

  it('knows which property a link sits under, block lists included', () => {
    const parsed = parseNote('---\nLinks: "[[mine]]"\nrelated:\n  - "[[auto a]]"\n- "[[auto b]]"\ntitle: x\n---\nBody [[body]]')
    expect(parsed.links.map((l) => [l.target, l.property ?? null])).toEqual([
      ['mine', 'Links'],
      ['auto a', 'related'],
      ['auto b', 'related'],
      ['body', null],
    ])
  })

  it('reads links from a list property, with headings and aliases', () => {
    const parsed = parseNote('---\nrefs: ["[[a#Intro|first]]", "[[b]]"]\n---\n')
    expect(parsed.links).toEqual([
      { target: 'a', heading: 'Intro', alias: 'first', line: 1, property: 'refs' },
      { target: 'b', heading: null, alias: null, line: 1, property: 'refs' },
    ])
  })

  it('does not treat an unterminated block as frontmatter links twice', () => {
    const parsed = parseNote('---\nrelated: [[x]]\nno closing fence')
    expect(parsed.links.map((l) => l.target)).toEqual(['x'])
  })
})

describe('markdown links', () => {
  it('counts [text](note) as a link to that note', () => {
    const { links } = parseNote('see [the book](Books/Atomic Habits.md) and [again](Atomic%20Habits)')
    expect(links.map((l) => [l.target, l.alias])).toEqual([
      ['Books/Atomic Habits.md', 'the book'],
      ['Atomic Habits', 'again'],
    ])
  })

  it('keeps the heading and drops a title', () => {
    const { links } = parseNote('[basis](Vectors.md#Basis) and [titled](Note.md "A title")')
    expect(links.map((l) => [l.target, l.heading])).toEqual([
      ['Vectors.md', 'Basis'],
      ['Note.md', null],
    ])
  })

  it('leaves what is not a note alone', () => {
    const { links } = parseNote('[site](https://example.com) [mail](mailto:a@b.c) [here](#Heading) ![shot](img.png) [empty]()')
    expect(links).toEqual([])
  })

  it('ignores links inside a fenced block, like wikilinks', () => {
    const { links } = parseNote('```\n[code](Atomic Habits.md)\n```\n[real](Atomic Habits.md)')
    expect(links.map((l) => l.alias)).toEqual(['real'])
  })
})

describe('extracting link targets', () => {
  it('collects distinct targets, stripping heading and alias', () => {
    expect(extractTargets('[[a]] [[b#h]] [[c|x]] [[a]]').sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores fenced code', () => {
    expect(extractTargets('[[a]]\n```\n[[b]]\n```')).toEqual(['a'])
  })

  it('returns nothing for a document without links', () => {
    expect(extractTargets('# just text')).toEqual([])
  })
})

describe('HTML comments', () => {
  const note = [
    '# Thread',
    'Visible text about soil.',
    '<!-- recto:sources [{"path":"Garden/Tomatoes.md"}] -->',
    'Before <!-- hidden [[Ideas]] #secret --> after [[Basil]]',
    '<!-- a comment',
    'over two lines [[Soil]] #tag',
    '-->',
    '```html',
    '<!-- inside code, kept -->',
    '```',
  ].join('\n')

  it('are not searchable text, links or tags, and every line keeps its number', () => {
    const parsed = parseNote(note)
    expect(parsed.body).not.toContain('Tomatoes')
    expect(parsed.body).not.toContain('over two lines')
    expect(parsed.body).toContain('Before  after [[Basil]]')
    expect(parsed.links.map((l) => l.target)).toEqual(['Basil'])
    expect(parsed.tags).toEqual([])
    expect(parsed.body.split('\n')).toHaveLength(note.split('\n').length)
  })

  it('inside a code fence are code, left as they are', () => {
    expect(parseNote(note).body).toContain('<!-- inside code, kept -->')
  })
})

