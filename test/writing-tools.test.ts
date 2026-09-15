import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { findStyleIssues, type StyleOptions } from '../src/renderer/editor/style-check'
import { tagText } from '../src/renderer/editor/syntax-tags'
import { focusRange } from '../src/renderer/editor/focus-range'

const ALL: StyleOptions = { fillers: true, cliches: true, redundancies: true, custom: true, customWords: [] }
const words = (text: string, options = ALL): string[] => findStyleIssues(text, options).map((i) => `${i.kind}:${i.text}`)

describe('style check', () => {
  it('finds fillers as whole words only', () => {
    expect(words('It was basically fine. I actually really liked it.')).toEqual([
      'filler:basically',
      'filler:actually',
      'filler:really',
    ])
    expect(words('Justice is reality.')).toEqual([])
  })

  it('prefers the longer phrase and the more specific list', () => {
    expect(words('At the end of the day it was a little bit late.')).toEqual(['cliche:At the end of the day', 'filler:a little bit'])
  })

  it('catches redundancies and Russian lists', () => {
    expect(words('The end result was an added bonus.')).toEqual(['redundancy:end result', 'redundancy:added bonus'])
    expect(words('На самом деле это как бы свободная вакансия.')).toEqual([
      'filler:На самом деле',
      'filler:как бы',
      'redundancy:свободная вакансия',
    ])
  })

  it('matches a phrase across a line break', () => {
    expect(words('kind\nof')).toEqual(['filler:kind\nof'])
  })

  it('uses the writer’s own words, and respects switched-off lists', () => {
    const options = { ...ALL, fillers: false, customWords: ['synergy', 'leverage'] }
    expect(words('We leverage synergy, basically.', options)).toEqual(['custom:leverage', 'custom:synergy'])
  })
})

describe('syntax tags', () => {
  const tagged = (text: string): Record<string, string> =>
    Object.fromEntries(tagText(text).map((t) => [text.slice(t.from, t.to), t.pos]))

  it('tags English parts of speech and leaves pronouns plain', () => {
    const tags = tagged('Like at last summer with Ilya (my friend). He quickly left and she stayed.')
    expect(tags['summer']).toBe('noun')
    expect(tags['friend']).toBe('noun')
    expect(tags['last']).toBe('adjective')
    expect(tags['quickly']).toBe('adverb')
    expect(tags['left']).toBe('verb')
    expect(tags['and']).toBe('conjunction')
    expect(tags['my']).toBeUndefined()
    expect(tags['He']).toBeUndefined()
  })

  it('colours the word, not its punctuation', () => {
    const text = '(friend).'
    const tag = tagText(text).find((t) => t.pos === 'noun')!
    expect(text.slice(tag.from, tag.to)).toBe('friend')
  })

  it('tags Russian by rules', () => {
    const tags = tagged('Красивый город и быстро работать, но я устал.')
    expect(tags['Красивый']).toBe('adjective')
    expect(tags['город']).toBe('noun')
    expect(tags['и']).toBe('conjunction')
    expect(tags['быстро']).toBe('adverb')
    expect(tags['работать']).toBe('verb')
    expect(tags['устал']).toBe('verb')
    expect(tags['я']).toBeUndefined()
  })
})

describe('focus range', () => {
  const doc = Text.of(['First sentence here. Second one! Third', 'wraps on.', '', '- item one', '- item two'])
  const slice = (pos: number, unit: 'line' | 'sentence' | 'paragraph'): string => {
    const r = focusRange(doc, pos, unit)
    return doc.sliceString(r.from, r.to)
  }

  it('lights the line', () => {
    expect(slice(3, 'line')).toBe('First sentence here. Second one! Third')
  })

  it('lights the sentence, across a wrapped line', () => {
    expect(slice(3, 'sentence')).toBe('First sentence here.')
    expect(slice(25, 'sentence')).toBe('Second one!')
    expect(slice(36, 'sentence')).toBe('Third\nwraps on.')
  })

  it('keeps the sentence just ended while the caret is in the gap after it', () => {
    expect(slice(20, 'sentence')).toBe('First sentence here.')
  })

  it('lights the paragraph, and treats list items as their own', () => {
    expect(slice(3, 'paragraph')).toBe('First sentence here. Second one! Third\nwraps on.')
    const item = doc.line(5).from + 3
    expect(slice(item, 'sentence')).toBe('- item two')
  })
})

import { EditorState } from '@codemirror/state'
import { authorAnnotation, authorField, fromStored, mapRanges, setAuthorRanges, toStored } from '../src/renderer/editor/authorship'
import { coerceWriting, DEFAULT_WRITING } from '../src/renderer/core/writing'
import { countWords } from '../src/renderer/components/FocusBar'

describe('authorship', () => {
  const start = (doc: string): EditorState => EditorState.create({ doc, extensions: [authorField] })

  it('marks pasted AI text, and only the pasted text', () => {
    let state = start('Mine. ')
    state = state.update({ changes: { from: 6, insert: 'Generated.' }, annotations: authorAnnotation.of('ai') }).state
    expect(state.field(authorField)).toEqual([{ from: 6, to: 16, author: 'ai' }])
  })

  it('turns text typed inside an AI passage into the writer’s own, splitting it', () => {
    let state = start('0123456789')
    state = state.update({ effects: setAuthorRanges.of([{ from: 0, to: 10, author: 'ai' }]) }).state
    state = state.update({ changes: { from: 5, insert: 'ME' } }).state
    expect(state.field(authorField)).toEqual([
      { from: 0, to: 5, author: 'ai' },
      { from: 7, to: 12, author: 'ai' },
    ])
  })

  it('does not grow a passage when typing at its edge', () => {
    const changes = EditorState.create({ doc: 'abcdef' }).update({ changes: { from: 3, insert: 'x' } }).changes
    expect(mapRanges([{ from: 0, to: 3, author: 'ai' }], changes, undefined)).toEqual([{ from: 0, to: 3, author: 'ai' }])
  })

  it('re-marks a selection with no text change', () => {
    let state = start('hello world')
    state = state.update({ selection: { anchor: 0, head: 5 } }).state
    state = state.update({ annotations: authorAnnotation.of('reference') }).state
    expect(state.field(authorField)).toEqual([{ from: 0, to: 5, author: 'reference' }])
    state = state.update({ selection: { anchor: 1, head: 3 }, annotations: authorAnnotation.of('human') }).state
    expect(state.field(authorField)).toEqual([
      { from: 0, to: 1, author: 'reference' },
      { from: 3, to: 5, author: 'reference' },
    ])
  })

  it('finds saved passages again after the note changed elsewhere, and drops ones that are gone', () => {
    const before = start('Intro. AI said this. Outro.')
    const stored = toStored(before.doc, [
      { from: 7, to: 20, author: 'ai' },
      { from: 21, to: 27, author: 'reference' },
    ])
    const after = start('New first line.\nIntro. AI said this. The end.')
    expect(fromStored(after.doc, stored)).toEqual([{ from: 23, to: 36, author: 'ai' }])
  })
})

describe('writing settings', () => {
  it('falls back field by field', () => {
    expect(coerceWriting(null)).toEqual(DEFAULT_WRITING)
    const read = coerceWriting({ focusUnit: 'chapter', dim: 9, syntax: { nouns: false, bogus: true }, style: { customWords: [' a ', 'a', 3, ''] } })
    expect(read.focusUnit).toBe('line')
    expect(read.dim).toBe(0.6)
    expect(read.syntax.nouns).toBe(false)
    expect(read.syntax.verbs).toBe(true)
    expect(read.style.customWords).toEqual(['a'])
  })
})

describe('word count', () => {
  it('counts the body, not frontmatter or markup', () => {
    expect(countWords('---\ntags:\n  - a\n---\n# Title here\n\nOne *two* [[Three|four]] five-six.')).toBe(7)
  })
})
