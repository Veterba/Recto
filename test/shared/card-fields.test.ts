import { describe, expect, it } from 'vitest'
import {
  cardDescription,
  cardFields,
  cardSpan,
  checklist,
  dateOnly,
  dueState,
  readPriority,
  readTags,
  setCardField,
  setCardTags,
  toggleCheck,
} from '../../src/shared/card-fields'

const note = (front: string, body = '# Card\n'): string => `---\n${front}\n---\n\n${body}`

describe('reading a card', () => {
  it('priority in any case; anything else is no priority', () => {
    expect(readPriority('High')).toBe('high')
    expect(readPriority(' low ')).toBe('low')
    expect(readPriority('p1')).toBeNull()
    expect(readPriority(undefined)).toBeNull()
  })

  it('a datetime is read as its date', () => {
    expect(dateOnly('2026-10-16')).toBe('2026-10-16')
    expect(dateOnly('2026-10-16T09:30')).toBe('2026-10-16')
    expect(dateOnly('"2026-10-16 09:30"')).toBe('2026-10-16')
    expect(dateOnly('next week')).toBeNull()
  })

  it('tags as a string, a list or the index copy, without a leading #', () => {
    expect(readTags('ui')).toEqual(['ui'])
    expect(readTags('#ui, editor')).toEqual(['ui', 'editor'])
    expect(readTags('[ui, "#editor"]')).toEqual(['ui', 'editor'])
    expect(readTags(['#ui', 'editor'])).toEqual(['ui', 'editor'])
    expect(readTags(null)).toEqual([])
  })

  it('a span from start and due; start after due is the due day alone', () => {
    expect(cardSpan('2026-10-12', '2026-10-16')).toEqual({ from: '2026-10-12', to: '2026-10-16' })
    expect(cardSpan(null, '2026-10-16')).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(cardSpan('2026-10-12', null)).toEqual({ from: '2026-10-12', to: '2026-10-12' })
    expect(cardSpan('2026-10-20', '2026-10-16')).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    expect(cardSpan(null, null)).toBeNull()
  })

  it('late after its last day, due soon within two days', () => {
    const today = '2026-10-16'
    expect(dueState(cardSpan(null, '2026-10-15'), today)).toBe('late')
    expect(dueState(cardSpan(null, '2026-10-16'), today)).toBe('soon')
    expect(dueState(cardSpan(null, '2026-10-18'), today)).toBe('soon')
    expect(dueState(cardSpan(null, '2026-10-19'), today)).toBeNull()
    expect(dueState(cardSpan('2026-10-10', '2026-10-20'), today)).toBeNull()
  })

  it('the description is the first paragraph, Markdown stripped', () => {
    const body = '# Card\n\n- [ ] step\n\nShip the **new** [[Settings panel|settings]] and `fix` it.\nSecond line.\n\nLater paragraph.'
    expect(cardDescription(body)).toBe('Ship the new settings and fix it. Second line.')
    expect(cardDescription('# Only a title\n\n- [x] done')).toBe('')
  })

  it('checklist items outside code, with their state', () => {
    const body = '- [ ] one\n- [x] **two**\n```\n- [ ] not this\n```\n1. [X] three'
    expect(checklist(body)).toEqual([
      { text: 'one', done: false },
      { text: 'two', done: true },
      { text: 'three', done: true },
    ])
  })
})

describe('writing a card', () => {
  it('changes only the edited key: order, other keys and comment lines stay', () => {
    const text = note('board: main\n# why this exists\nstatus: todo\npriority: low\norder: 2')
    expect(setCardField(text, 'priority', 'high')).toBe(note('board: main\n# why this exists\nstatus: todo\npriority: high\norder: 2'))
    expect(setCardField(text, 'due', '2026-10-16')).toBe(
      note('board: main\n# why this exists\nstatus: todo\npriority: low\norder: 2\ndue: 2026-10-16'),
    )
    expect(setCardField(text, 'priority', null)).toBe(note('board: main\n# why this exists\nstatus: todo\norder: 2'))
  })

  it('a trailing comment on the edited line survives', () => {
    expect(setCardField(note('due: 2026-10-01 # hard deadline'), 'due', '2026-10-09')).toBe(note('due: 2026-10-09 # hard deadline'))
  })

  it('tags keep the shape they were written in', () => {
    expect(setCardTags(note('tags: ui'), ['editor'])).toBe(note('tags: editor'))
    expect(setCardTags(note('tags: [ui, docs]'), ['editor', 'docs'])).toBe(note('tags: [editor, docs]'))
    expect(setCardTags(note('tags: ui, docs'), ['editor', 'docs'])).toBe(note('tags: editor, docs'))
    expect(setCardTags(note('tags:\n  - ui\n  - docs\nstatus: todo'), ['editor', 'docs'])).toBe(
      note('tags:\n  - editor\n  - docs\nstatus: todo'),
    )
    expect(setCardTags(note('status: todo'), ['#ui'])).toBe(note('status: todo\ntags: [ui]'))
    expect(setCardTags(note('status: todo\ntags: ui'), [])).toBe(note('status: todo'))
  })

  it('toggles exactly one checkbox and nothing else', () => {
    const text = note('status: todo', '# Card\n\n- [ ] one\n```\n- [ ] code\n```\n- [x] two\r\n')
    expect(toggleCheck(text, 1)).toBe(note('status: todo', '# Card\n\n- [ ] one\n```\n- [ ] code\n```\n- [ ] two\r\n'))
    expect(toggleCheck(text, 0)).toBe(note('status: todo', '# Card\n\n- [x] one\n```\n- [ ] code\n```\n- [x] two\r\n'))
    expect(toggleCheck(text, 5)).toBe(text)
  })
})

describe("a card's fields from its text", () => {
  it('reads what the board shows, the way the index keeps it', () => {
    const text = '---\npriority: High\nstart: 2026-10-14\ndue: 2026-10-16\ntags: [ui, docs]\n---\n\nFirst words.\n\n- [x] a\n- [ ] b\n'
    expect(cardFields(text)).toEqual({
      start: '2026-10-14',
      due: '2026-10-16',
      completed: null,
      priority: 'High',
      tags: 'ui,docs',
      description: 'First words.',
      checklist: { done: 1, total: 2 },
    })
  })

  it('an old card whose first line is an H1 repeating its name does not use it as description', () => {
    expect(cardDescription('# Ship it\n\nThe real description.')).toBe('The real description.')
    expect(cardFields('---\nstatus: todo\n---\n# Ship it\n').description).toBe('')
  })
})
