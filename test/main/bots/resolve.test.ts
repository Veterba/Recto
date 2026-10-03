import { describe, expect, it } from 'vitest'
import { closestTitles, findNote, resolveNames, resolveScope, spelledTitles, type VaultNote } from '../../../src/main/bots/resolve'

const note = (path: string, aliases: string[] = []): VaultNote => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  aliases,
})

const NOTES = [
  note('Programming/Projects/Trasncript pipeline.md'),
  note('Learning/School/Tutta.md'),
  note('Other/Japan trip.md'),
  note('Other/Kepano about notes.md'),
  note('Other/How I use knowledge manager.md'),
  note('Other/Knowledge managers.md'),
  note('Programming/Projects/Recto app/Recto plan.md'),
  note('Programming/Projects/Recto app/Recto log/Recto log.md'),
  note('Daily/2026/09/W39/2026-09-21.md'),
  note('Template/Daily.md'),
  note('Norsk/Norskkurs.md', ['norsk course']),
]

const FOLDERS = [
  'Learning',
  'Learning/Math Khan Academy',
  'Learning/School',
  'Programming',
  'Programming/Projects',
  'Programming/Projects/Recto app',
  'Programming/Projects/Recto app/Recto log',
  'Daily',
  'Other',
  'Template',
]

describe('named notes', () => {
  it('finds a quoted title through a misspelling', () => {
    const r = resolveNames('What would you improve about the project "Transcript pipeline" itself?', NOTES)
    expect(r.named.map((n) => n.title)).toEqual(['Trasncript pipeline'])
    expect(r.notFound).toEqual([])
  })

  it('finds a quoted title and an alias, case-insensitively', () => {
    expect(resolveNames('Everything is in the "tutta" note.', NOTES).named[0]?.title).toBe('Tutta')
    expect(findNote('Norsk Course', NOTES)?.title).toBe('Norskkurs')
  })

  it('reports a name that matches nothing, with the closest titles', () => {
    const r = resolveNames('Look in [[Recto roadmap]]', NOTES)
    expect(r.named).toEqual([])
    expect(r.notFound[0]?.asked).toBe('Recto roadmap')
    expect(r.notFound[0]?.closest).toContain('Recto plan')
    expect(closestTitles('Recto roadmap', NOTES)).toHaveLength(3)
  })

  it('spots titles spelled out in a sentence, never dates or common words', () => {
    expect(spelledTitles('Help me with my trip to Japan.', NOTES).map((n) => n.title)).toEqual(['Japan trip'])
    const ru = spelledTitles(
      "О чём говорит Кепано (Kepano). ... есть заметка где я описывал принцип ведения knowledge manager'ов.",
      NOTES,
    ).map((n) => n.title)
    expect(ru).toContain('Kepano about notes')
    expect(ru).toContain('Knowledge managers')
    expect(spelledTitles('what did I do on my daily notes', NOTES)).toEqual([])
    expect(spelledTitles('Check [[x]] - what ratio did I use?', [note('Home/Apartment move checklist.md')])).toEqual([])
  })
})

describe('named scopes', () => {
  it('finds a folder by a word of its name', () => {
    expect(resolveScope('What would you improve in my math notes?', FOLDERS, [])).toEqual({
      kind: 'folder',
      folder: 'Learning/Math Khan Academy',
      words: 'Math Khan Academy',
    })
  })

  it('takes the project folder, not its log subfolder', () => {
    const s = resolveScope('задачи из заметок связанных с моим приложением Recto', FOLDERS, [])
    expect(s).toMatchObject({ kind: 'folder', folder: 'Programming/Projects/Recto app' })
  })

  it('knows the whole vault in English and Russian', () => {
    expect(resolveScope('Suggest templates based on the notes currently in my vault.', FOLDERS, [])?.kind).toBe('vault')
    expect(resolveScope('Что бы ты улучшил в структуре моего хранилища опираясь на все заметки?', FOLDERS, [])?.kind).toBe('vault')
  })

  it('finds a topic by its words', () => {
    expect(resolveScope('notes about equations and formulas', [], ['Equation · formula'])).toMatchObject({ kind: 'topic' })
  })

  it('names no scope for a plain question', () => {
    expect(resolveScope('Help me prepare for the Norwegian exam.', FOLDERS, [])).toBeNull()
  })
})
