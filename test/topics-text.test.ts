import { describe, expect, it, vi } from 'vitest'
import { excludedFolders, isEligible } from '../src/main/autolinks/eligible'
import { isSettled } from '../src/main/autolinks/score'
import {
  chunk,
  countWords,
  linkShare,
  MAX_CHUNK_WORDS,
  MIN_CHUNK_WORDS,
  ownLines,
  ownText,
  snippet,
  templateLines,
  titleInput,
} from '../src/main/autolinks/text'
import { DEFAULT_TEMPLATE_SETTINGS } from '../src/renderer/core/templates'
import { linksIn, writeLinks } from '../src/renderer/core/link-property'

const doc = (...lines: string[]): string => lines.join('\n')
const words = (n: number, word = 'alpha'): string => Array.from({ length: n }, () => word).join(' ')
const own = (text: string, templates: string[] = []): string => ownText(ownLines(text, templateLines(templates)))

describe('own text', () => {
  it('drops frontmatter and code blocks', () => {
    const text = doc('---', 'title: Secret words', 'tags: [x]', '---', 'Body line.', '```js', 'const hidden = 1', '```', 'After.')
    expect(own(text)).toBe('Body line.\nAfter.')
  })

  it('drops lines identical to any template line, but not lines that merely contain one', () => {
    const template = doc('---', 'Links: "[[Daily]]"', '---', '## Notes / Thoughts', '- Empty', '- [ ]')
    const note = doc('## Notes / Thoughts', '- Empty', '- Empty handed today, went to the shop')
    expect(own(note, [template])).toBe('- Empty handed today, went to the shop')
  })

  it('drops lines that are only links, and keeps a link inside a sentence as its words', () => {
    const note = doc('[[A]] [[B]]', '- [[C|see C]]', 'Read [[Deep Work|the book]] and [[Atomic Habits]] again.', '![[pic.png]]')
    expect(own(note)).toBe('Read the book and Atomic Habits again.')
  })

  it('turns markdown links into their text and drops embeds', () => {
    expect(own('Try [the guide](Guide.md) and ![alt](x.png) now.')).toBe('Try the guide and  now.')
  })

  it('counts words in any script', () => {
    expect(countWords('Заметка про SQL, и ещё 42 слова — it’s fine')).toBe(9)
  })
})

describe('chunker', () => {
  it('keeps every chunk between 40 and 300 words when the text allows it', () => {
    const paragraphs = [5, 12, 80, 300, 700, 20, 3, 150, 45].map((n, i) => words(n, `w${i}`))
    const chunks = chunk(ownLines(paragraphs.join('\n\n'), new Set()))
    for (const c of chunks) {
      expect(c.words).toBeLessThanOrEqual(MAX_CHUNK_WORDS)
      expect(c.words).toBeGreaterThanOrEqual(MIN_CHUNK_WORDS)
    }
    expect(chunks.reduce((sum, c) => sum + c.words, 0)).toBe(5 + 12 + 80 + 300 + 700 + 20 + 3 + 150 + 45)
  })

  it('merges short neighbours and keeps the heading as the chunk prefix', () => {
    const text = doc('# Garden', '', words(10), '', words(10), '', '## Soil', '', words(100, 'soil'))
    const chunks = chunk(ownLines(text, new Set()))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.heading).toBe('Garden')
    // The section it swallowed keeps its heading as a line.
    expect(chunks[0]?.text).toContain('\n\nSoil\nsoil soil')
  })

  it('gives a short note one chunk', () => {
    expect(chunk(ownLines('Just a few words here.', new Set()))).toHaveLength(1)
  })

  it('builds the title vector text from name, aliases and headings', () => {
    const text = doc('---', 'aliases: [SD, Levain]', '---', '# Feeding', 'text', '## Storage')
    expect(titleInput('Baking/Sourdough.md', text)).toBe('Sourdough, SD, Levain\nFeeding; Storage')
  })

  it('makes a one-line reason without list markers or emphasis', () => {
    expect(snippet('- **SQL** is `fun`\n- joins', 100)).toBe('SQL is fun · joins')
    expect(snippet(words(50), 20)).toHaveLength(20)
  })
})

describe('the settled rule', () => {
  const HOUR = 3_600_000
  const base = { quietMs: HOUR, minWords: 60, ownWords: 100, currentMean: [1, 0] }
  const now = 10 * HOUR

  it('waits out the quiet period: 30 min is too soon, 60 is not', () => {
    expect(isSettled({ ...base, now, mtime: now - 0.5 * HOUR, state: null })).toBe(false)
    expect(isSettled({ ...base, now, mtime: now - HOUR, state: null })).toBe(true)
  })

  it('needs enough own words', () => {
    expect(isSettled({ ...base, now, mtime: 0, ownWords: 59, state: null })).toBe(false)
  })

  it('does not re-evaluate a note whose meaning and size stayed put', () => {
    const state = { evaluatedAt: 5 * HOUR, meanVec: [1, 0], ownWords: 100 }
    expect(isSettled({ ...base, now, mtime: 4 * HOUR, state })).toBe(false)
    // An older mtime than the last look still counts when the text moved.
    expect(isSettled({ ...base, now, mtime: 4 * HOUR, state, ownWords: 140 })).toBe(true)
  })

  it('re-evaluates when the meaning drifted below 0.92', () => {
    const state = { evaluatedAt: 1 * HOUR, meanVec: [1, 0], ownWords: 100 }
    const drifted = [Math.cos(0.45), Math.sin(0.45)] // cos 0.90
    const close = [Math.cos(0.3), Math.sin(0.3)] // cos 0.955
    expect(isSettled({ ...base, now, mtime: 2 * HOUR, state, currentMean: drifted })).toBe(true)
    expect(isSettled({ ...base, now, mtime: 2 * HOUR, state, currentMean: close })).toBe(false)
  })

  it('re-evaluates when own words grew by 30%', () => {
    const state = { evaluatedAt: 1 * HOUR, meanVec: [1, 0], ownWords: 100 }
    expect(isSettled({ ...base, now, mtime: 2 * HOUR, state, ownWords: 129 })).toBe(false)
    expect(isSettled({ ...base, now, mtime: 2 * HOUR, state, ownWords: 130 })).toBe(true)
  })
})

describe('hubs and twins', () => {
  it('measures how much of a note is links, by words', () => {
    expect(linkShare(doc('- [[Alpha note]]', '- [[Beta note]]', '- [[Gamma]] and a word'), new Set())).toBeCloseTo(5 / 8)
    expect(linkShare('Prose with one [[Link]] in it.', new Set())).toBeCloseTo(1 / 6)
    expect(linkShare('', new Set())).toBe(0)
  })
})

describe('exclusions', () => {
  const templates = { ...DEFAULT_TEMPLATE_SETTINGS, folder: 'Template', daily: { enabled: true, folder: 'Daily', template: null } }
  const excluded = excludedFolders(templates, ['Archive/'])

  it('leaves out daily notes, templates, chats, tasks, attachments and listed folders', () => {
    for (const p of ['Daily/2026/09/W39/2026-09-24.md', 'Template/Daily.md', 'chats/x.md', 'tasks/card.md', 'Archive/old.md']) {
      expect(isEligible(p, excluded)).toBe(false)
    }
  })

  it('matches folders by segment, not by prefix', () => {
    expect(isEligible('Dailyish/idea.md', excluded)).toBe(true)
    expect(isEligible('Notes/Daily.md', excluded)).toBe(true)
  })
})

describe('the link-property writer', () => {
  it('adds the property and changes no other byte', () => {
    const before = doc(
      '---',
      'title: "Keep: me"',
      'Links: "[[Daily]]"',
      'nested:',
      '  a: 1',
      '# a comment',
      'tags:',
      '  - x',
      '---',
      '',
      'Body with [[Link]] and trailing spaces   ',
      '',
    )
    const after = writeLinks(before, 'related', ['A', 'folder/B'])
    const added = 'related: ["[[A]]", "[[folder/B]]"]'
    expect(after.split('\n').filter((line) => !before.split('\n').includes(line))).toEqual([added])
    expect(after.replace(`${added}\n`, '')).toBe(before)
    expect(linksIn(after, 'related')).toEqual(['A', 'folder/B'])
  })

  it('replaces only its own key, keeps a block list a block list, and removes the key when emptied', () => {
    const before = doc('---', 'a: 1', 'related:', '  - "[[Old]]"', 'z: 2', '---', 'Body')
    const after = writeLinks(before, 'related', ['New', 'Other'])
    expect(after).toBe(doc('---', 'a: 1', 'related:', '  - "[[New]]"', '  - "[[Other]]"', 'z: 2', '---', 'Body'))
    expect(writeLinks(after, 'related', [])).toBe(doc('---', 'a: 1', 'z: 2', '---', 'Body'))
  })

  it('leaves a zero-indent block list untouched', () => {
    const before = doc('---', 'tags:', '- a', '- b', 'title: x', '---', 'Body')
    const after = writeLinks(before, 'related', ['A'])
    expect(after).toBe(doc('---', 'tags:', '- a', '- b', 'title: x', 'related: ["[[A]]"]', '---', 'Body'))
    expect(writeLinks(after, 'related', [])).toBe(before)
  })

  it('refuses a write that would change anything but its own key, and says so', () => {
    // Mixed line endings: the frontmatter editor joins on \n, so writing
    // `related` would silently strip the \r from the other lines.
    const mixed = '---\r\ntitle: x\n---\nBody\r\n'
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(writeLinks(mixed, 'related', ['A'])).toBe(mixed)
    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('refused')
    error.mockRestore()
  })

  it('keeps CRLF line endings', () => {
    const before = '---\r\ntitle: x\r\n---\r\nBody\r\n'
    expect(writeLinks(before, 'related', ['A'])).toBe('---\r\ntitle: x\r\nrelated: ["[[A]]"]\r\n---\r\nBody\r\n')
  })

  it('creates the frontmatter when the note has none', () => {
    expect(writeLinks('Body', 'related', ['A'])).toBe('---\nrelated: ["[[A]]"]\n---\n\nBody')
  })
})
