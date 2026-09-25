import { describe, expect, it } from 'vitest'
import { rewriteWikiLinks } from '../src/main/link-rewrite'
import { assign, assignThreshold, continues, selectTopics, silhouettes, similarities } from '../src/main/topics/cluster'
import {
  block,
  coerceState,
  emptyState,
  pending,
  renamePath,
  setAssigned,
  setOwned,
  topicLink,
  topicNameOf,
} from '../src/main/topics/state'
import { centroid, cosine, evenly, noteVector, vaultMean } from '../src/main/topics/vectors'
import { linksIn, writeLinks } from '../src/renderer/core/link-property'

/** A unit vector near axis `k` in `dims` dimensions, nudged by `noise` on the next axis. */
const near = (k: number, noise = 0, dims = 8): Float32Array => {
  const v = new Float32Array(dims)
  v[k] = 1
  v[(k + 1) % dims] = noise
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}

describe('note vectors', () => {
  it('centring on the vault mean removes what every note shares', () => {
    // Two notes on different subjects that share a large common direction.
    const shared = [0, 0, 5]
    const a = [[1, 0, 0].map((x, i) => x + shared[i]!)]
    const b = [[0, 1, 0].map((x, i) => x + shared[i]!)]
    const raw = cosine(centroid(a[0]!.map((x) => [x]).flat().length ? [a[0]!] : []), centroid([b[0]!]))
    const mean = vaultMean([...a, ...b], 3)
    const va = noteVector(a, mean)!
    const vb = noteVector(b, mean)!
    expect(raw).toBeGreaterThan(0.9)
    expect(cosine(va, vb)).toBeLessThan(0)
  })

  it('takes at most 48 chunks, evenly spaced, first and last included', () => {
    expect(evenly(10, 48)).toHaveLength(10)
    const picks = evenly(500, 48)
    expect(picks).toHaveLength(48)
    expect(picks[0]).toBe(0)
    expect(picks.at(-1)).toBe(499)
    expect(noteVector([], new Float32Array(3))).toBeNull()
  })
})

describe('finding topics', () => {
  const groups = [
    [near(0, 0.1), near(0, 0.2), near(0, 0.15), near(0, 0.05)],
    [near(3, 0.1), near(3, 0.2), near(3, 0.12)],
    [near(6, 0.1), near(6, 0.3)],
  ]
  const vectors = groups.flat()
  const topics = (vs: Float32Array[]): number[][] => selectTopics(similarities(vs), vs.length)

  it('finds the groups, largest first; a cluster needs three notes to be a topic', () => {
    expect(topics(vectors)).toEqual([[0, 1, 2, 3], [4, 5, 6]])
  })

  it('does not assume topics are rare: a vault that is all topics is all topics', () => {
    // Every note belongs to one of three subjects - a third of all pairs are same-topic.
    const dense = [0, 3, 6].flatMap((k) => [near(k, 0.1), near(k, 0.2), near(k, 0.15), near(k, 0.05)])
    expect(topics(dense)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]])
  })

  it('leaves out a tight pair near a topic: too small to be one, too far to belong to it', () => {
    const mixed = [near(0, 0.1), near(0, 0.15), near(0, 0.05), near(0, 0.12), near(1, 0.9), near(1, 0.95), near(4), near(5, 0.5), near(7, 0.3)]
    expect(topics(mixed)).toEqual([[0, 1, 2, 3]])
  })

  it('scores clusters by silhouette: tight and apart is high', () => {
    const [tight] = silhouettes(similarities(vectors), vectors.length, [[0, 1, 2, 3]])
    const [loose] = silhouettes(similarities(vectors), vectors.length, [[0, 1, 4, 5]])
    expect(tight).toBeGreaterThan(0.5)
    expect(loose).toBeLessThan(tight!)
  })

  it('finds nothing in fewer than three notes', () => {
    expect(topics([near(0), near(0, 0.1)])).toEqual([])
  })
})

describe('keeping topics stable', () => {
  const python = { id: 'py', vector: near(0) }
  const rust = { id: 'rs', vector: near(3) }

  it('T_ASSIGN is the 5th percentile of member-to-centroid similarity', () => {
    const t = assignThreshold([[near(0, 0.1), near(0, 0.3), near(0, 0.2)]])
    expect(t).toBeCloseTo(cosine(near(0, 0.3), centroid([near(0, 0.1), near(0, 0.3), near(0, 0.2)])), 3)
  })

  it('assigns the best topic when it clears T_ASSIGN and beats the second by 0.03', () => {
    expect(assign(near(0, 0.1), [python, rust], 0.8)).toEqual(['py'])
    expect(assign(near(0, 0.1), [python, rust], 0.999)).toEqual([])
  })

  it('refuses when two topics are too close to call', () => {
    const between = new Float32Array([1, 0, 0, 1, 0, 0, 0, 0]).map((x) => x / Math.SQRT2)
    expect(assign(between, [python, rust], 0.5)).toEqual([])
  })

  it('adds a second topic only when it too clears T_ASSIGN', () => {
    const leaning = new Float32Array([0.8, 0, 0, 0.6, 0, 0, 0, 0])
    expect(assign(leaning, [python, rust], 0.55)).toEqual(['py', 'rs'])
    expect(assign(leaning, [python, rust], 0.7)).toEqual(['py'])
  })

  it('a rebuilt cluster keeps an old topic when members overlap by half or more', () => {
    const old = [
      { id: 'a', members: new Set(['1', '2', '3', '4']) },
      { id: 'b', members: new Set(['7', '8', '9']) },
    ]
    expect(continues(new Set(['1', '2', '3', '5']), old, new Set())).toBe('a')
    expect(continues(new Set(['1', '5', '6', '9']), old, new Set())).toBeNull()
    expect(continues(new Set(['1', '2', '3', '5']), old, new Set(['a']))).toBeNull()
  })
})

describe('the topics state', () => {
  it('reads a hand-edited file field by field', () => {
    const state = coerceState({ topics: [{ id: 'a', name: 'Python' }, { id: 3 }], owned: { 'n.md': ['a', 4] }, junk: 1 })
    expect(state.topics).toEqual([{ id: 'a', name: 'Python', renamedByUser: false }])
    expect(state.owned).toEqual({ 'n.md': ['a'] })
    expect(coerceState(null)).toEqual(emptyState())
  })

  it('knows which notes still wait to be written', () => {
    let s = setAssigned(emptyState(), 'a.md', ['t1'])
    s = setAssigned(s, 'b.md', ['t1'])
    s = setOwned(s, 'b.md', ['t1'])
    s = setOwned(s, 'c.md', ['t2'])
    expect(pending(s)).toEqual(['a.md', 'c.md'])
  })

  it('a topic the user removed from a note is blocked there for good', () => {
    let s = setOwned(setAssigned(emptyState(), 'a.md', ['t1']), 'a.md', ['t1'])
    s = block(s, 'a.md', 't1')
    expect(s.blocks).toEqual({ 'a.md': ['t1'] })
    expect(s.assigned).toEqual({})
    expect(pending(setAssigned(s, 'a.md', ['t1']))).toEqual([])
  })

  it('follows a folder move', () => {
    const s = renamePath(setOwned(emptyState(), 'A/n.md', ['t1']), 'A', 'B')
    expect(s.owned).toEqual({ 'B/n.md': ['t1'] })
  })

  it('topic links live under topics/ and read back to their name', () => {
    expect(topicLink('Processor · memory')).toBe('topics/Processor · memory')
    expect(topicNameOf('topics/Processor · memory')).toBe('Processor · memory')
    expect(topicNameOf('Topics/Python.md')).toBe('Python')
    expect(topicNameOf('Python')).toBeNull()
  })
})

describe('topics in a note', () => {
  it('writes the topics property and leaves everything else alone', () => {
    const before = '---\ntags: [x]\nLinks: "[[Daily]]"\n---\nBody [[Python]]'
    const after = writeLinks(before, 'topics', ['topics/Python', 'topics/Processor · memory'])
    expect(after).toBe('---\ntags: [x]\nLinks: "[[Daily]]"\ntopics: ["[[topics/Python]]", "[[topics/Processor · memory]]"]\n---\nBody [[Python]]')
    expect(linksIn(after, 'topics')).toEqual(['topics/Python', 'topics/Processor · memory'])
    expect(writeLinks(after, 'topics', [])).toBe(before)
  })

  it('a rename rewrites a topic link that resolves to nothing, and nothing else', () => {
    const text = '---\ntopics: ["[[topics/Old name]]", "[[topics/Other]]"]\n---\nSee [[topics/Old name|the topic]] and [[Old name]].'
    const { text: out, count } = rewriteWikiLinks(text, 'topics/Old name.md', 'topics/New name.md', true)
    expect(count).toBe(2)
    expect(out).toBe('---\ntopics: ["[[topics/New name]]", "[[topics/Other]]"]\n---\nSee [[topics/New name|the topic]] and [[Old name]].')
  })
})
