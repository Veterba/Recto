import { describe, expect, it } from 'vitest'
import { nameTokens, planTidy, type TidyInput } from '../src/renderer/core/tidy'

/**
 * Tidy moves files and rewrites links. Every rule it applies is tested here,
 * because the failure mode is not a crash - it is a vault quietly reorganised
 * in a way nobody asked for.
 */

const plan = (input: Partial<TidyInput> & Pick<TidyInput, 'notes'>) =>
  planTidy({
    folders: [],
    context: new Map(),
    ...input,
  })

const ctx = (entries: Record<string, { tags?: string[]; links?: string[] }>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, { tags: v.tags ?? [], links: v.links ?? [] }]))

describe('what tidy leaves alone', () => {
  it('never touches a note that is already in a folder', () => {
    const result = plan({ notes: ['work/a.md', 'work/b.md'], folders: ['work'] })
    expect(result.moves).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('leaves a loose note with no signal, and says why', () => {
    const result = plan({ notes: ['thoughts.md'], folders: ['work'] })
    expect(result.moves).toEqual([])
    expect(result.skipped[0]?.path).toBe('thoughts.md')
    expect(result.skipped[0]?.reason).toMatch(/no tags, links/)
  })

  it('never moves anything into a reserved folder', () => {
    // The card folder is owned by the board; a stray note landing in it would
    // appear on a kanban that nobody put it on.
    const result = plan({
      notes: ['dsa.md'],
      folders: ['tasks'],
      reserved: ['tasks'],
      context: ctx({ 'dsa.md': { tags: ['#tasks'] } }),
    })
    expect(result.moves).toEqual([])
  })

  it('never moves a note that is already inside a reserved folder', () => {
    const result = plan({ notes: ['tasks/card.md'], folders: ['tasks', 'work'], reserved: ['tasks'] })
    expect(result.moves).toEqual([])
  })
})

describe('rule 1 — a tag naming an existing folder', () => {
  it('moves the note there', () => {
    const result = plan({
      notes: ['meeting.md'],
      folders: ['work'],
      context: ctx({ 'meeting.md': { tags: ['#work'] } }),
    })
    expect(result.moves).toEqual([
      { path: 'meeting.md', into: 'work', creates: false, reason: 'tagged #work' },
    ])
  })

  it('finds a nested folder by its last segment', () => {
    const result = plan({
      notes: ['meeting.md'],
      folders: ['projects/work'],
      context: ctx({ 'meeting.md': { tags: ['#work'] } }),
    })
    expect(result.moves[0]?.into).toBe('projects/work')
  })

  it('matches a tag to a folder across case and punctuation', () => {
    const result = plan({
      notes: ['a.md'],
      folders: ['Deep Work'],
      context: ctx({ 'a.md': { tags: ['#deep-work'] } }),
    })
    expect(result.moves[0]?.into).toBe('Deep Work')
  })

  it('matches non-Latin tags', () => {
    const result = plan({
      notes: ['a.md'],
      folders: ['Работа'],
      context: ctx({ 'a.md': { tags: ['#работа'] } }),
    })
    expect(result.moves[0]?.into).toBe('Работа')
  })
})

describe('rule 2 — where its links live', () => {
  it('follows the majority of its links', () => {
    const result = plan({
      notes: ['loose.md'],
      folders: ['work', 'home'],
      context: ctx({ 'loose.md': { links: ['work/a.md', 'work/b.md', 'home/c.md'] } }),
    })
    expect(result.moves[0]?.into).toBe('work')
    expect(result.moves[0]?.reason).toBe('links to 2 notes in work')
  })

  it('refuses to guess on a tie', () => {
    // Two equally good answers is not a signal, and picking one is how a
    // tidy-up loses your trust.
    const result = plan({
      notes: ['loose.md'],
      folders: ['work', 'home'],
      context: ctx({ 'loose.md': { links: ['work/a.md', 'home/b.md'] } }),
    })
    expect(result.moves).toEqual([])
    expect(result.skipped).toHaveLength(1)
  })

  it('ignores links to other loose notes, which say nothing about folders', () => {
    const result = plan({
      notes: ['loose.md', 'other.md'],
      folders: ['work'],
      context: ctx({ 'loose.md': { links: ['other.md'] } }),
    })
    expect(result.moves).toEqual([])
  })

  it('loses to a tag, which is the stronger signal', () => {
    const result = plan({
      notes: ['loose.md'],
      folders: ['work', 'home'],
      context: ctx({ 'loose.md': { tags: ['#home'], links: ['work/a.md', 'work/b.md'] } }),
    })
    expect(result.moves[0]?.into).toBe('home')
  })
})

describe('rule 3 — a word in the name', () => {
  it('matches a folder by a word in the file name', () => {
    const result = plan({ notes: ['recipes dinner.md'], folders: ['Recipes'] })
    expect(result.moves[0]).toEqual({
      path: 'recipes dinner.md',
      into: 'Recipes',
      creates: false,
      reason: 'name matches Recipes',
    })
  })

  it('does not match on a stopword', () => {
    const result = plan({ notes: ['the note.md'], folders: ['The'] })
    expect(result.moves).toEqual([])
  })
})

describe('rules 4 and 5 — inventing folders', () => {
  it('groups two notes sharing a tag into a new folder named for it', () => {
    const result = plan({
      notes: ['a.md', 'b.md'],
      context: ctx({ 'a.md': { tags: ['#recipes'] }, 'b.md': { tags: ['#recipes'] } }),
    })
    expect(result.moves.map((m) => [m.path, m.into, m.creates])).toEqual([
      ['a.md', 'Recipes', true],
      ['b.md', 'Recipes', true],
    ])
  })

  it('will not invent a folder for a single tagged note', () => {
    const result = plan({ notes: ['a.md'], context: ctx({ 'a.md': { tags: ['#recipes'] } }) })
    expect(result.moves).toEqual([])
  })

  it('needs three notes before inventing a folder from their names', () => {
    // A shared word between two files is often a coincidence; a shared tag is
    // something the user typed on purpose, so it earns a lower bar.
    expect(plan({ notes: ['berlin trip.md', 'berlin food.md'] }).moves).toEqual([])
    const three = plan({ notes: ['berlin trip.md', 'berlin food.md', 'berlin hotels.md'] })
    expect(three.moves.map((m) => m.into)).toEqual(['Berlin', 'Berlin', 'Berlin'])
    expect(three.moves[0]?.creates).toBe(true)
  })

  it('puts a note in the bigger group when it fits two', () => {
    const result = plan({
      notes: ['a.md', 'b.md', 'c.md'],
      context: ctx({
        'a.md': { tags: ['#big', '#small'] },
        'b.md': { tags: ['#big'] },
        'c.md': { tags: ['#big'] },
      }),
    })
    expect(new Set(result.moves.map((m) => m.into))).toEqual(new Set(['Big']))
  })

  it('does not invent a folder that already exists under another case', () => {
    const result = plan({
      notes: ['a.md', 'b.md'],
      folders: ['recipes'],
      context: ctx({ 'a.md': { tags: ['#recipes'] }, 'b.md': { tags: ['#recipes'] } }),
    })
    // Rule 1 already handles these; the grouping pass must not create a second
    // `Recipes` beside the existing `recipes`.
    expect(result.moves.every((m) => m.into === 'recipes' && !m.creates)).toBe(true)
  })
})

describe('name tokens', () => {
  it('splits on punctuation and drops noise', () => {
    expect(nameTokens('2026-09-13 my new note.md')).toEqual([])
    expect(nameTokens('berlin-trip_notes.md')).toEqual(['berlin', 'trip'])
  })

  it('keeps non-Latin words', () => {
    expect(nameTokens('заметка о работе.md')).toEqual(['заметка', 'работе'])
  })
})
