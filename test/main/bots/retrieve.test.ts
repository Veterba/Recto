import { describe, expect, it } from 'vitest'
import { fuse, MIN_VECTOR_SCORE, pick, RRF_K, wordRanked } from '../../../src/main/bots/retrieve'
import { classify } from '../../../src/main/bots/classify'
import type { RouteKind } from '../../../src/main/bots/router'

const note = (path: string, content: string): { path: string; title: string; content: string } => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  content,
})

describe('hybrid retrieval', () => {
  const plan = note('Projects/Lark/Lark plan.md', '# Notifications\nAt most two reminders a day, never after 21:00.')
  const log = note('Projects/Lark/Lark log.md', 'Notifications decided, see the plan. [[a]] [[b]]')

  it('reads only pieces that hold the question’s words', () => {
    const pieces = wordRanked([plan], ['notification', 'reminder'])
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.heading).toBe('Notifications')
  })

  it('fuses words and meaning with RRF, a piece found both ways first', () => {
    const fused = fuse({
      terms: ['notification', 'reminder'],
      ftsNotes: [plan],
      vectorHits: [
        { path: 'Other/x.md', idx: 0, heading: '', text: 'unrelated', score: MIN_VECTOR_SCORE + 0.1 },
        { path: plan.path, idx: 0, heading: 'Notifications', text: 'At most two…', score: MIN_VECTOR_SCORE + 0.05 },
      ],
      hubs: new Set(),
    })
    expect(fused[0]!.path).toBe(plan.path)
    expect(fused[0]!.via).toEqual(['words', 'meaning'])
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2))
  })

  it('drops vector hits below the floor', () => {
    const fused = fuse({
      terms: [],
      ftsNotes: [],
      vectorHits: [{ path: 'a.md', idx: 0, heading: '', text: 't', score: 0.1 }],
      hubs: new Set(),
    })
    expect(fused).toEqual([])
  })

  it('pushes index notes down unless named, and dated entries up', () => {
    const hits = [
      { path: 'Projects/Lark/Lark log.md', idx: 0, heading: '', text: 'index', score: 0.9 },
      { path: 'Projects/Lark/Lark log/2026-09-21 — v0.6.md', idx: 0, heading: '', text: 'entry', score: 0.8 },
    ]
    const plain = fuse({ terms: [], ftsNotes: [log], vectorHits: hits, hubs: new Set() })
    expect(plain[0]!.title).toBe('2026-09-21 — v0.6')
    // A daily note is dated too, but it is no log entry: no lift.
    const daily = fuse({
      terms: [],
      ftsNotes: [],
      vectorHits: [{ path: 'Daily/2026-09-21.md', idx: 0, heading: '', text: 'd', score: 0.9 }],
      hubs: new Set(),
    })
    expect(daily[0]!.score).toBeCloseTo(1 / (RRF_K + 1))
    const named = fuse({ terms: [], ftsNotes: [], vectorHits: hits, hubs: new Set(), named: new Set(['Projects/Lark/Lark log.md']) })
    expect(named.find((c) => c.title === 'Lark log')!.score).toBeCloseTo(1 / (RRF_K + 1))
    expect(plain.find((c) => c.title === 'Lark log')!.score).toBeCloseTo(0.5 / (RRF_K + 1))
  })

  it('picks at most two pieces per note within the budget', () => {
    const c = (path: string, idx: number, text = 'x'.repeat(300)) => ({
      path,
      title: path,
      heading: null,
      text,
      idx,
      key: `${path}#${idx}`,
      score: 1,
      via: [] as ('words' | 'meaning')[],
    })
    const picked = pick([c('a', 0), c('a', 1), c('a', 2), c('b', 0), c('c', 0)], { max: 6, budget: 6000 })
    expect(picked.map((p) => p.key)).toEqual(['a#0', 'a#1', 'b#0', 'c#0'])
    expect(pick([c('a', 0, 'y'.repeat(5000)), c('b', 0, 'z'.repeat(5000))], { budget: 6000 })[1]!.text.length).toBeLessThanOrEqual(1000)
  })
})

describe('the router’s classifier', () => {
  const unit = (i: number): number[] => Array.from({ length: 4 }, (_, j) => (j === i ? 1 : 0))
  const examples = {
    notes: [unit(0), unit(0)],
    review: [unit(1)],
    advice: [unit(2)],
    tasks: [unit(3)],
    recent: [unit(3)],
    smalltalk: [unit(3)],
    self: [unit(3)],
  } as Record<RouteKind, number[][]>

  it('takes the nearest kind and is sure when it clearly wins', () => {
    const c = classify([0.1, 0.95, 0.1, 0], examples)
    expect(c.kind).toBe('review')
    expect(c.confident).toBe(true)
  })

  it('is not sure between two kinds', () => {
    expect(classify([0.7, 0.7, 0, 0], examples).confident).toBe(false)
  })

  it('calls a question far from every kind a question about the notes', () => {
    expect(classify([0.3, 0.3, 0.3, 0.3], examples)).toMatchObject({ kind: 'notes', confident: true })
  })
})
