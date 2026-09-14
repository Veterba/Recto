import { describe, expect, it } from 'vitest'
import { edited, plainText, readingTime, summariseNote } from '../src/renderer/core/note-preview'

const NOTE = [
  '---',
  'title: Ignored because the H1 wins',
  'tags: [work, planning]',
  'status: draft',
  'due: 2026-09-20',
  '---',
  '# Q4 plan',
  '',
  'The **short** version: ship the [[Graph view|graph]] and fix search.',
  'Then look at #mobile.',
  '',
  '## Goals',
  '- [x] graph',
  '- [ ] search',
  '- [ ] sync',
  '',
  '### Risks',
  'Hiring.',
  '',
  '```ts',
  '## not a heading',
  '- [ ] not a task',
  '```',
  '',
  '![chart](attachments/q4.png)',
  'See [[Roadmap]] and [[Graph view]].',
].join('\n')

describe('summariseNote', () => {
  const preview = summariseNote(NOTE, 'q4.md')

  it('takes the title from the first H1', () => {
    expect(preview.title).toBe('Q4 plan')
  })

  it('gathers tags from frontmatter and from the body', () => {
    expect(preview.tags.sort()).toEqual(['mobile', 'planning', 'work'])
  })

  it('shows properties, but not tags or title twice', () => {
    expect(preview.properties).toEqual([
      { key: 'status', value: 'draft' },
      { key: 'due', value: '2026-09-20' },
    ])
  })

  it('outlines H2 and H3, in order', () => {
    expect(preview.outline).toEqual([
      { level: 2, text: 'Goals' },
      { level: 3, text: 'Risks' },
    ])
  })

  it('makes the opening prose readable, with the alias rather than the link target', () => {
    expect(preview.excerpt).toBe('The short version: ship the graph and fix search. Then look at #mobile.')
  })

  /** The fence is the trap: a heading or task inside code is code. */
  it('counts tasks outside code blocks only', () => {
    expect(preview.tasks).toEqual({ done: 1, total: 3 })
  })

  it('does not outline a heading inside a code block', () => {
    expect(preview.outline.map((h) => h.text)).not.toContain('not a heading')
  })

  it('counts distinct outgoing links and images', () => {
    expect(preview.links).toBe(2)
    expect(preview.images).toBe(1)
  })

  it('falls back to the frontmatter title, then the file name', () => {
    expect(summariseNote('---\ntitle: From front\n---\nbody', 'x.md').title).toBe('From front')
    expect(summariseNote('just text', 'My note.md').title).toBe('My note')
  })

  it('clips a long opening at a word', () => {
    const long = summariseNote(`# T\n\n${'word '.repeat(200)}`, 't.md').excerpt
    expect(long.length).toBeLessThanOrEqual(281)
    expect(long.endsWith('…')).toBe(true)
    expect(long).not.toMatch(/wor…$/)
  })

  it('survives an empty note', () => {
    expect(summariseNote('', 'Empty.md')).toMatchObject({ title: 'Empty', excerpt: '', words: 0, tasks: { done: 0, total: 0 } })
  })
})

describe('plainText', () => {
  it('strips inline markdown', () => {
    expect(plainText('> a *b* `c` ~~d~~ ==e== [f](http://x)')).toBe('a b c d e f')
  })
})

describe('readingTime', () => {
  it('reads like a person would say it', () => {
    expect(readingTime(0)).toBe('empty')
    expect(readingTime(50)).toBe('under a minute')
    expect(readingTime(690)).toBe('3 min read')
  })
})

describe('edited', () => {
  const now = new Date(2026, 8, 14, 12, 0).getTime()
  it('is relative while recent', () => {
    expect(edited(now - 10_000, now)).toBe('just now')
    expect(edited(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(edited(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(edited(now - 30 * 3_600_000, now)).toBe('yesterday')
    expect(edited(now - 3 * 86_400_000, now)).toBe('3 days ago')
  })
})
