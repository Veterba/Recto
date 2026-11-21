import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../src/shared/frontmatter'
import { coerceSettings, convertValue, emptyValue, kindFromValue, kindOf, typesFromObsidian } from '../../src/shared/property-types'

/** A property's type: set for its name (Recto's, then Obsidian's), else read from its value. */

const field = (yaml: string) => parseFrontmatter(`---\n${yaml}\n---\n`).fields[0]!

describe('a property read from its value', () => {
  it.each([
    ['count: 3', 'number'],
    ['done: true', 'checkbox'],
    ['due: 2026-11-21', 'date'],
    ['tags: [a, b]', 'list'],
    ['up: "[[Home]]"', 'link'],
    ['site: https://example.com/a?b=1', 'url'],
    ['mail: vell@example.com', 'email'],
    ['note: words here', 'text'],
    ['blank:', 'text'],
  ])('%s is %s', (yaml, kind) => {
    expect(kindFromValue(field(yaml))).toBe(kind)
  })
})

describe('a property with a type set', () => {
  it('takes Recto’s, then Obsidian’s, then its value’s', () => {
    const f = field('code: 42')
    expect(kindOf(f, { code: 'text' }, { code: 'list' })).toBe('text')
    expect(kindOf(f, {}, { code: 'list' })).toBe('list')
    expect(kindOf(f, {}, {})).toBe('number')
  })
})

describe('the vault’s settings', () => {
  it('keeps the types it knows and leaves out the rest', () => {
    expect(coerceSettings({ types: { a: 'url', b: 'nonsense', c: 3 } })).toEqual({ types: { a: 'url' } })
    expect(coerceSettings(null)).toEqual({ types: {} })
  })

  it('reads Obsidian’s types.json in Recto’s names', () => {
    expect(typesFromObsidian('{"types":{"aliases":"aliases","tags":"tags","due":"date","at":"datetime","n":"number","ok":"checkbox","who":"multitext","x":"unknown"}}')).toEqual({
      aliases: 'list',
      tags: 'list',
      due: 'date',
      at: 'date',
      n: 'number',
      ok: 'checkbox',
      who: 'list',
    })
    expect(typesFromObsidian('not json')).toEqual({})
    expect(typesFromObsidian(null)).toEqual({})
  })
})

describe('a value made into another type', () => {
  it('keeps what it can', () => {
    expect(convertValue('12', 'number')).toBe(12)
    expect(convertValue('a, b', 'list')).toEqual(['a', 'b'])
    expect(convertValue(['a', 'b'], 'text')).toBe('a, b')
    expect(convertValue('2026-11-21T10:00', 'date')).toBe('2026-11-21')
    expect(convertValue('true', 'checkbox')).toBe(true)
    expect(convertValue(7, 'url')).toBe('7')
  })

  it('makes nothing of what it cannot keep', () => {
    expect(convertValue('soon', 'number')).toBeNull()
    expect(convertValue('next week', 'date')).toBeNull()
    expect(convertValue('', 'list')).toBeNull()
    expect(convertValue(null, 'checkbox')).toBe(false)
  })

  it('starts a new one empty, a checkbox off', () => {
    expect(emptyValue('checkbox')).toBe(false)
    expect(emptyValue('url')).toBeNull()
  })
})
