import { describe, expect, it, vi } from 'vitest'
import { excludedFolders, isEligible, sameName } from '../src/main/autolinks/eligible'
import {
  addAuto,
  addConfirmed,
  lastRun,
  coerceRecord,
  emptyRecord,
  renameInRecord,
  setOutcome,
  setWritten,
  writtenTo,
} from '../src/main/autolinks/record'
import {
  autoEntries,
  chooseThreshold,
  compareVectors,
  effectiveAuto,
  HYSTERESIS,
  isSettled,
  mentionableNames,
  pick,
  planAuto,
  reconcileWritten,
  score,
  semantic,
  shouldRaise,
  sweep,
  vaultThresholds,
} from '../src/main/autolinks/score'
import {
  chunk,
  countWords,
  linkShare,
  MAX_CHUNK_WORDS,
  MIN_CHUNK_WORDS,
  mentions,
  ownLines,
  ownText,
  plainText,
  snippet,
  templateLines,
  titleInput,
} from '../src/main/autolinks/text'
import { DEFAULT_TEMPLATE_SETTINGS } from '../src/renderer/core/templates'
import { linkTextFor, relatedTargets, writeRelated } from '../src/renderer/core/related'

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

describe('scoring', () => {
  const none = { tags: new Set<string>(), out: new Set<string>(), inDegree: 0 }

  it('sem is the mean of the best two similarities', () => {
    expect(semantic([0.1, 0.9, 0.5, 0.7])).toBeCloseTo(0.8)
    expect(semantic([0.4])).toBeCloseTo(0.4)
    const { sem, bestChunk } = compareVectors([[1, 0], [0, 1]], [[0, 1], [0.6, 0.8]])
    expect(sem).toBeCloseTo(0.9)
    expect(bestChunk).toBe(1)
  })

  it('adds 0.15 for a verbatim title or alias, on word boundaries, any case', () => {
    const source = { ownText: 'I keep reading about deep work lately.', tags: new Set<string>(), out: new Set<string>() }
    expect(score(0.5, 'T', source, { ...none, names: ['Deep Work'] }).title).toBe(0.15)
    expect(score(0.5, 'T', source, { ...none, names: ['Work L'] }).title).toBe(0)
    expect(mentions('Пишу про заметки', 'заметки')).toBe(true)
    expect(mentions('Пишу про заметкиx', 'заметки')).toBe(false)
  })

  it('adds 0.05 per shared tag, capped at 0.10', () => {
    const source = { ownText: '', tags: new Set(['a', 'b', 'c']), out: new Set<string>() }
    expect(score(0.5, 'T', source, { ...none, names: [], tags: new Set(['a']) }).tags).toBeCloseTo(0.05)
    expect(score(0.5, 'T', source, { ...none, names: [], tags: new Set(['a', 'b', 'c']) }).tags).toBeCloseTo(0.1)
  })

  it('adds 0.05 for co-citation of a third note', () => {
    const source = { ownText: '', tags: new Set<string>(), out: new Set(['X']) }
    expect(score(0.5, 'T', source, { ...none, names: [], out: new Set(['X']) }).cocite).toBe(0.05)
    expect(score(0.5, 'T', source, { ...none, names: [], out: new Set(['Y']) }).cocite).toBe(0)
  })

  it('penalises hubs by -0.04 log2(1 + in/5)', () => {
    const source = { ownText: '', tags: new Set<string>(), out: new Set<string>() }
    expect(score(0.5, 'T', source, { ...none, names: [], inDegree: 15 }).hub).toBeCloseTo(-0.08)
    expect(score(0.5, 'T', source, { ...none, names: [], inDegree: 0 }).hub).toBeCloseTo(0)
  })

  it('gates on sem and ranks by score: a bonus reorders, never lifts over the bar', () => {
    const scored = [
      { target: 'lifted', sem: 0.7, total: 0.95 }, // bonuses alone would clear 0.75
      { target: 'a', sem: 0.8, total: 0.8 },
      { target: 'b', sem: 0.76, total: 0.9 },
    ]
    expect(pick(scored, 0.75, 3).map((s) => s.target)).toEqual(['b', 'a'])
    expect(pick(scored, 0.75, 1).map((s) => s.target)).toEqual(['b'])
    expect(planAuto([], scored, 0.75, 2)).toEqual(['b', 'a'])
  })

  it('gives the title bonus only to names that pick out one note', () => {
    const unique = (): boolean => true
    const generic = ['index', 'notes', 'Tags']
    expect(mentionableNames(['Deep Work', 'DW'], unique, generic)).toEqual(['Deep Work'])
    expect(mentionableNames(['Index', 'tags', 'NOTES'], unique, generic)).toEqual([])
    expect(mentionableNames(['Sourdough'], () => false, generic)).toEqual([])
    expect(mentionableNames(['Язык'], unique, generic)).toEqual(['Язык'])
  })

  it('does not count a name inside a link or a code block as a mention', () => {
    const text = doc('See [[Deep Work]] and [the book](Deep Work.md).', '```', 'Deep Work', '```', 'Nothing else.')
    const plain = plainText(ownLines(text, new Set()))
    const source = { ownText: plain, tags: new Set<string>(), out: new Set<string>() }
    const facts = { names: ['Deep Work'], tags: new Set<string>(), out: new Set<string>(), inDegree: 0 }
    expect(score(0.8, 'T', source, facts).title).toBe(0)
    const mentioned = plainText(ownLines('I keep coming back to deep work.', new Set()))
    expect(score(0.8, 'T', { ...source, ownText: mentioned }, facts).title).toBe(0.15)
  })
})

describe('hysteresis', () => {
  const T = 0.8

  it('keeps a link we added until its sem falls below 0.85 x T_AUTO', () => {
    const kept = [{ target: 'a', sem: T * HYSTERESIS + 0.001, total: 0 }]
    expect(planAuto(['a'], kept, T, 3)).toEqual(['a'])
    const dropped = [{ target: 'a', sem: T * HYSTERESIS - 0.001, total: 2 }]
    expect(planAuto(['a'], dropped, T, 3)).toEqual([])
  })

  it('needs the full T_AUTO for a new link, so a borderline one does not flap in', () => {
    const scored = [{ target: 'b', sem: T - 0.01, total: 1 }]
    expect(planAuto([], scored, T, 3)).toEqual([])
    // ...and once in, the same score keeps it.
    expect(planAuto(['b'], scored, T, 3)).toEqual(['b'])
  })

  it('caps at max links, best score first', () => {
    const scored = ['a', 'b', 'c', 'd'].map((target, i) => ({ target, sem: 0.9, total: 0.9 - i * 0.01 }))
    expect(planAuto([], scored, T, 2)).toEqual(['a', 'b'])
  })
})

describe('what happened to links we wrote', () => {
  it('a link deleted by hand is a rejection; one moved elsewhere in the note is pinned', () => {
    const result = reconcileWritten(['kept', 'deleted', 'moved'], new Set(['kept']), new Set(['moved']))
    expect(result).toEqual({ still: ['kept'], pinned: ['moved'], rejected: ['deleted'] })
  })
})

describe('calibration sweep', () => {
  it('reports precision and recall of the top 3 and picks the lowest threshold reaching 0.7', () => {
    const trials = [
      { predictions: [{ total: 0.9, hit: true }, { total: 0.6, hit: false }] },
      { predictions: [{ total: 0.8, hit: true }, { total: 0.7, hit: false }] },
      { predictions: [{ total: 0.75, hit: false }] },
    ]
    const rows = sweep(trials, [0.6, 0.7, 0.76, 0.85])
    expect(rows.map((r) => [r.threshold, r.predicted, +r.precision.toFixed(2), +r.recall.toFixed(2)])).toEqual([
      [0.6, 5, 0.4, 0.67],
      [0.7, 4, 0.5, 0.67],
      [0.76, 2, 1, 0.67],
      [0.85, 1, 1, 0.33],
    ])
    expect(chooseThreshold(rows)).toBe(0.76)
    expect(chooseThreshold(sweep([{ predictions: [{ total: 0.9, hit: false }] }], [0.5]))).toBeNull()
  })
})

describe('per-vault thresholds', () => {
  const sems = (values: number[]): number[] => values

  it('T_AUTO is the 99th percentile of random pairs, T_SUGGEST the 95th, with floors 0.75 and 0.70', () => {
    // 0.000 .. 0.999: p99 = 0.989, p95 = 0.949.
    const spread = sems(Array.from({ length: 1000 }, (_, i) => i / 1000))
    expect(vaultThresholds(spread)).toEqual({ tAuto: 0.989, tSuggest: 0.949 })
    // A vault where random pairs are dissimilar never goes under the floors.
    expect(vaultThresholds(sems(Array.from({ length: 500 }, () => 0.4)))).toEqual({ tAuto: 0.75, tSuggest: 0.7 })
  })

  it('the feedback raise adds to the measured base, up to 0.90', () => {
    expect(effectiveAuto(0.8, 0.04)).toBeCloseTo(0.84)
    expect(effectiveAuto(0.88, 0.06)).toBeCloseTo(0.9)
    // A measured base above the cap is not pulled down by it.
    expect(effectiveAuto(0.93, 0.02)).toBeCloseTo(0.93)
    expect(effectiveAuto(null, 0.02)).toBeNull()
  })

  it('raises when more than a third of the last 20 auto-links were deleted, on fresh evidence only', () => {
    const window = (deleted: number) =>
      Array.from({ length: 20 }, (_, i) => (i < deleted ? { outcome: 'deleted' } : {}))
    expect(shouldRaise(window(6), 0, 0.8, 0).raise).toBe(false)
    expect(shouldRaise(window(7), 0, 0.8, 0).raise).toBe(true)
    // Fewer than 20 so far: not a window yet.
    expect(shouldRaise(window(7).slice(0, 19), 0, 0.8, 0).raise).toBe(false)
    // The same 20 that caused the last raise do not cause another.
    expect(shouldRaise(window(7), 20, 0.8, 0.02).raise).toBe(false)
    expect(shouldRaise([...window(7), ...window(7)], 20, 0.8, 0.02).raise).toBe(true)
    // At the cap it stops.
    expect(shouldRaise(window(20), 0, 0.88, 0.02).raise).toBe(false)
  })
})

describe('the vault record', () => {
  it('reads a hand-edited file field by field', () => {
    const record = coerceRecord({ rejected: [['a', 'b'], 'junk'], written: { 'n.md': ['t.md', 3] }, raisedBy: 0.02 })
    expect(record.rejected).toEqual([['a', 'b']])
    expect(record.written).toEqual({ 'n.md': ['t.md'] })
    expect(record.raisedBy).toBe(0.02)
    expect(coerceRecord(null)).toEqual(emptyRecord())
  })

  it('marks the latest auto-add of a pair with its outcome', () => {
    let record = addAuto(emptyRecord(), [{ source: 's', target: 't', score: 0.8 }], 1)
    record = addAuto(record, [{ source: 's', target: 't', score: 0.8 }], 2)
    record = setOutcome(record, 's', 't', 'deleted')
    expect(record.auto.map((a) => a.outcome)).toEqual([undefined, 'deleted'])
    expect(addConfirmed(record, 's', 't').confirmed).toEqual([['s', 't']])
  })

  it('knows what the latest run wrote that is still in place', () => {
    let record = addAuto(emptyRecord(), [{ source: 'a', target: 'x', score: 1 }], 1, 100)
    record = setWritten(record, 'a', ['x'])
    record = addAuto(record, [{ source: 'b', target: 'y', score: 1 }, { source: 'b', target: 'z', score: 1 }, { source: 'c', target: 'y', score: 1 }], 2, 200)
    record = setWritten(setWritten(record, 'b', ['y', 'z']), 'c', ['y'])
    // One of the latest run's links was deleted by hand already.
    record = setOutcome(record, 'c', 'y', 'deleted')
    const last = lastRun(record)!
    expect(last.run).toBe(200)
    expect(Object.fromEntries(last.bySource)).toEqual({ b: ['y', 'z'] })
    expect(lastRun(emptyRecord())).toBeNull()
  })

  it('follows a rename and a folder move through keys and targets', () => {
    let record = setWritten(emptyRecord(), 'A/note.md', ['A/target.md', 'B/x.md'])
    record = { ...record, rejected: [['A/note.md', 'C/y.md']] }
    const moved = renameInRecord(record, 'A', 'Z')
    expect(moved.written).toEqual({ 'Z/note.md': ['Z/target.md', 'B/x.md'] })
    expect(moved.rejected).toEqual([['Z/note.md', 'C/y.md']])
  })
})

describe('ownership after an index rebuild', () => {
  /**
   * The record lives in `.recto/autolinks.json`; a rebuild deletes index.db
   * and nothing else. So after a rebuild the record reads back exactly as it
   * was written - and a note it has no entry for owns its whole property.
   */
  const note = doc('---', 'related: ["[[Mine A]]", "[[Mine B]]", "[[Ours]]"]', '---', 'Body')
  const paths: Record<string, string> = { 'Mine A': 'Mine A.md', 'Mine B': 'Mine B.md', Ours: 'Ours.md', New: 'New.md' }
  const resolve = (entry: string): string | null => paths[entry] ?? null
  const linkText = (p: string): string => p.replace(/\.md$/, '')
  const tAuto = 0.8
  const nothingScores = [
    { target: 'Mine A.md', sem: 0, total: 0 },
    { target: 'Mine B.md', sem: 0, total: 0 },
    { target: 'Ours.md', sem: 0, total: 0 },
  ]

  it('never removes user entries, even when nothing scores - with no record for the note', () => {
    const afterRebuild = coerceRecord(JSON.parse(JSON.stringify(emptyRecord())))
    const ours = new Set(writtenTo(afterRebuild, 'note.md'))
    expect(ours.size).toBe(0)
    const next = planAuto([...ours], nothingScores, tAuto, 2)
    const entries = autoEntries(relatedTargets(note, 'related'), resolve, ours, next, linkText)
    expect(entries).toEqual(['Mine A', 'Mine B', 'Ours'])
    // And a new link is appended beside them, not in place of them.
    const withNew = autoEntries(relatedTargets(note, 'related'), resolve, ours, ['New.md'], linkText)
    expect(withNew).toEqual(['Mine A', 'Mine B', 'Ours', 'New'])
  })

  it('removes only what the record says we wrote, and the record survives the rebuild', () => {
    const before = setWritten(emptyRecord(), 'note.md', ['Ours.md'])
    const afterRebuild = coerceRecord(JSON.parse(JSON.stringify(before)))
    const ours = new Set(writtenTo(afterRebuild, 'note.md'))
    const next = planAuto([...ours], nothingScores, tAuto, 2)
    expect(next).toEqual([])
    const entries = autoEntries(relatedTargets(note, 'related'), resolve, ours, next, linkText)
    expect(entries).toEqual(['Mine A', 'Mine B'])
  })
})

describe('hubs and twins', () => {
  it('measures how much of a note is links, by words', () => {
    expect(linkShare(doc('- [[Alpha note]]', '- [[Beta note]]', '- [[Gamma]] and a word'), new Set())).toBeCloseTo(5 / 8)
    expect(linkShare('Prose with one [[Link]] in it.', new Set())).toBeCloseTo(1 / 6)
    expect(linkShare('', new Set())).toBe(0)
  })

  it('never pairs two notes with the same name', () => {
    expect(sameName('Interview preparing.md', 'Other/Interview preparing.md')).toBe(true)
    expect(sameName('a/Index.md', 'b/index.md')).toBe(true)
    expect(sameName('a/Index.md', 'a/Indexes.md')).toBe(false)
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

describe('the related writer', () => {
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
    const after = writeRelated(before, 'related', ['A', 'folder/B'])
    const added = 'related: ["[[A]]", "[[folder/B]]"]'
    expect(after.split('\n').filter((line) => !before.split('\n').includes(line))).toEqual([added])
    expect(after.replace(`${added}\n`, '')).toBe(before)
    expect(relatedTargets(after, 'related')).toEqual(['A', 'folder/B'])
  })

  it('replaces only its own key, keeps a block list a block list, and removes the key when emptied', () => {
    const before = doc('---', 'a: 1', 'related:', '  - "[[Old]]"', 'z: 2', '---', 'Body')
    const after = writeRelated(before, 'related', ['New', 'Other'])
    expect(after).toBe(doc('---', 'a: 1', 'related:', '  - "[[New]]"', '  - "[[Other]]"', 'z: 2', '---', 'Body'))
    expect(writeRelated(after, 'related', [])).toBe(doc('---', 'a: 1', 'z: 2', '---', 'Body'))
  })

  it('leaves a zero-indent block list untouched', () => {
    const before = doc('---', 'tags:', '- a', '- b', 'title: x', '---', 'Body')
    const after = writeRelated(before, 'related', ['A'])
    expect(after).toBe(doc('---', 'tags:', '- a', '- b', 'title: x', 'related: ["[[A]]"]', '---', 'Body'))
    expect(writeRelated(after, 'related', [])).toBe(before)
  })

  it('refuses a write that would change anything but its own key, and says so', () => {
    // Mixed line endings: the frontmatter editor joins on \n, so writing
    // `related` would silently strip the \r from the other lines.
    const mixed = '---\r\ntitle: x\n---\nBody\r\n'
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(writeRelated(mixed, 'related', ['A'])).toBe(mixed)
    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain('refused')
    error.mockRestore()
  })

  it('keeps CRLF line endings', () => {
    const before = '---\r\ntitle: x\r\n---\r\nBody\r\n'
    expect(writeRelated(before, 'related', ['A'])).toBe('---\r\ntitle: x\r\nrelated: ["[[A]]"]\r\n---\r\nBody\r\n')
  })

  it('creates the frontmatter when the note has none', () => {
    expect(writeRelated('Body', 'related', ['A'])).toBe('---\nrelated: ["[[A]]"]\n---\n\nBody')
  })

  it('writes a bare name when it is unique, the path when it is not', () => {
    expect(linkTextFor('a/Note.md', ['a/Note.md', 'b/Other.md'])).toBe('Note')
    expect(linkTextFor('a/Note.md', ['a/Note.md', 'b/Note.md'])).toBe('a/Note')
  })
})
