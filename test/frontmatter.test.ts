import { describe, expect, it } from 'vitest'
import {
  bodyOf,
  parseFrontmatter,
  removeField,
  renameField,
  serialize,
  setField,
} from '../src/renderer/core/frontmatter'

const doc = (...lines: string[]): string => lines.join('\n')

describe('parsing frontmatter', () => {
  it('reads flat keys and classifies their types', () => {
    const fm = parseFrontmatter(
      doc('---', 'title: NordicSync', 'order: 3', 'done: true', 'empty:', '---', '# Body'),
    )
    expect(fm.present).toBe(true)
    expect(fm.fields.map((f) => [f.key, f.value, f.type])).toEqual([
      ['title', 'NordicSync', 'text'],
      ['order', 3, 'number'],
      ['done', true, 'boolean'],
      ['empty', null, 'empty'],
    ])
  })

  it('detects dates and lists', () => {
    const fm = parseFrontmatter(doc('---', 'due: 2026-09-20', 'tags: [a, b]', 'people: x, y', '---'))
    expect(fm.fields.map((f) => [f.key, f.type])).toEqual([
      ['due', 'date'],
      ['tags', 'list'],
      ['people', 'list'],
    ])
    expect(fm.fields[1]?.value).toEqual(['a', 'b'])
    expect(fm.fields[2]?.value).toEqual(['x', 'y'])
  })

  it('treats a quoted value as text even when it looks like a number', () => {
    const fm = parseFrontmatter(doc('---', 'version: "3"', '---'))
    expect(fm.fields[0]?.value).toBe('3')
    expect(fm.fields[0]?.type).toBe('text')
  })

  it('reports no frontmatter when the file does not start with a fence', () => {
    expect(parseFrontmatter('# Just a note').present).toBe(false)
  })

  it('refuses an unterminated fence rather than swallowing the whole note', () => {
    // Treating this as frontmatter would mean editing a property rewrites the note.
    const fm = parseFrontmatter(doc('---', 'title: broken', '', '# still body'))
    expect(fm.present).toBe(false)
    expect(fm.bodyStart).toBe(0)
  })

  it('keeps nested maps and list continuations as opaque, never as fields', () => {
    const fm = parseFrontmatter(
      doc('---', 'title: ok', 'nested:', '  a: 1', '  b: 2', 'tags:', '  - one', '  - two', '---'),
    )
    expect(fm.fields.map((f) => f.key)).toEqual(['title'])
    expect(fm.opaque.length).toBeGreaterThan(0)
  })

  it('keeps comments opaque', () => {
    const fm = parseFrontmatter(doc('---', '# a comment', 'title: ok', '---'))
    expect(fm.fields.map((f) => f.key)).toEqual(['title'])
    expect(fm.opaque).toEqual(['# a comment'])
  })

  it('handles unicode keys and values', () => {
    const fm = parseFrontmatter(doc('---', 'название: заметка', '---'))
    expect(fm.fields[0]?.value).toBe('заметка')
  })
})

describe('setField', () => {
  it('replaces an existing value in place, leaving everything else alone', () => {
    const before = doc('---', 'title: old', 'order: 3', '---', '', '# Body', 'text')
    expect(setField(before, 'title', 'new')).toBe(
      doc('---', 'title: new', 'order: 3', '---', '', '# Body', 'text'),
    )
  })

  it('appends a new key inside the block', () => {
    const before = doc('---', 'title: t', '---', '# Body')
    expect(setField(before, 'order', 5)).toBe(doc('---', 'title: t', 'order: 5', '---', '# Body'))
  })

  it('creates the block when the file has none', () => {
    expect(setField('# Body', 'title', 't')).toBe(doc('---', 'title: t', '---', '', '# Body'))
  })

  it('never touches the body', () => {
    const body = doc('# Heading', '', 'A paragraph with --- dashes and a [[link]].', '', '```', 'code', '```')
    const before = doc('---', 'title: t', '---', '', body)
    expect(bodyOf(setField(before, 'order', 1))).toBe(doc('', body))
  })

  it('preserves nested structures it does not understand', () => {
    const before = doc('---', 'nested:', '  a: 1', 'title: t', '---', '# Body')
    const after = setField(before, 'title', 'changed')
    expect(after).toContain('nested:')
    expect(after).toContain('  a: 1')
    expect(after).toContain('title: changed')
  })

  it('round-trips every type', () => {
    let text = '# Body'
    text = setField(text, 'text', 'hello')
    text = setField(text, 'num', 42)
    text = setField(text, 'bool', false)
    text = setField(text, 'list', ['a', 'b'])
    const fields = parseFrontmatter(text).fields
    expect(fields.map((f) => [f.key, f.value])).toEqual([
      ['text', 'hello'],
      ['num', 42],
      ['bool', false],
      ['list', ['a', 'b']],
    ])
  })

  it('quotes a string that would otherwise change type on the way back', () => {
    // Without quoting, reading this back would give the number 3.
    const text = setField('# Body', 'version', '3')
    expect(text).toContain('version: "3"')
    expect(parseFrontmatter(text).fields[0]?.value).toBe('3')
    expect(parseFrontmatter(text).fields[0]?.type).toBe('text')
  })

  it('quotes a string containing a colon-space, which would otherwise parse as a key', () => {
    const text = setField('# Body', 'note', 'see: this')
    expect(parseFrontmatter(text).fields[0]?.value).toBe('see: this')
  })

  it('writes an empty value rather than dropping the key', () => {
    const text = setField(doc('---', 'a: 1', '---'), 'a', null)
    expect(parseFrontmatter(text).fields.map((f) => [f.key, f.type])).toEqual([['a', 'empty']])
  })
})

describe('removeField', () => {
  it('removes one key and keeps the rest', () => {
    const before = doc('---', 'a: 1', 'b: 2', '---', '# Body')
    expect(removeField(before, 'a')).toBe(doc('---', 'b: 2', '---', '# Body'))
  })

  it('removes the whole block when the last key goes', () => {
    const before = doc('---', 'a: 1', '---', '', '# Body')
    expect(removeField(before, 'a')).toBe('# Body')
  })

  it('keeps the block when opaque lines remain', () => {
    const before = doc('---', 'a: 1', 'nested:', '  x: 1', '---', '# Body')
    const after = removeField(before, 'a')
    expect(after).toContain('nested:')
    expect(after).toContain('---')
  })

  it('is a no-op for a key that is not there', () => {
    const before = doc('---', 'a: 1', '---', '# Body')
    expect(removeField(before, 'zzz')).toBe(before)
    expect(removeField('# Body', 'a')).toBe('# Body')
  })
})

describe('renameField', () => {
  it('renames in place, keeping the value and position', () => {
    const before = doc('---', 'a: 1', 'b: 2', '---')
    expect(renameField(before, 'a', 'z')).toBe(doc('---', 'z: 1', 'b: 2', '---'))
  })

  it('refuses to rename onto an existing key rather than clobbering it', () => {
    const before = doc('---', 'a: 1', 'b: 2', '---')
    expect(renameField(before, 'a', 'b')).toBe(before)
  })
})

describe('serialize', () => {
  it('renders each type', () => {
    expect(serialize('text')).toBe('text')
    expect(serialize(7)).toBe('7')
    expect(serialize(true)).toBe('true')
    expect(serialize(['a', 'b'])).toBe('[a, b]')
    expect(serialize(null)).toBe('')
  })

  it('drops empty list entries', () => {
    expect(serialize(['a', '', ' ', 'b'])).toBe('[a, b]')
  })
})

describe('unicode keys', () => {
  it('treats a Cyrillic key as an editable field, not opaque text', () => {
    // An ASCII-only key pattern silently demotes these to read-only.
    const fm = parseFrontmatter(doc('---', 'название: заметка', 'приоритет: 3', '---'))
    expect(fm.opaque).toEqual([])
    expect(fm.fields.map((f) => [f.key, f.value])).toEqual([
      ['название', 'заметка'],
      ['приоритет', 3],
    ])
  })

  it('can set and remove a unicode key', () => {
    let text = setField('# Body', 'дата', '2026-09-12')
    expect(parseFrontmatter(text).fields[0]?.type).toBe('date')
    text = setField(text, 'тема', 'работа')
    expect(parseFrontmatter(text).fields.map((f) => f.key)).toEqual(['дата', 'тема'])
    expect(parseFrontmatter(removeField(text, 'дата')).fields.map((f) => f.key)).toEqual(['тема'])
  })
})
