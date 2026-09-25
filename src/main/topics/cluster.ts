/**
 * Topics from note vectors: find them, assign to them, keep them stable.
 *
 * Pure numbers - the service feeds in vectors and writes the results - so each
 * rule here is tested without a model.
 */

import { centroid, cosine } from './vectors'

/** A cluster needs this many notes to become a topic. */
export const MIN_TOPIC_SIZE = 3
/** A note's best topic must beat its second by this much. */
export const ASSIGN_MARGIN = 0.03
export const MAX_TOPICS_PER_NOTE = 2
/** Rebuild keeps a topic's id and name when its members overlap this much. */
export const KEEP_OVERLAP = 0.5
/** A cluster must hold together over at least this much similarity before it merges into a bigger one. */
export const MIN_LIFETIME = 0.05
/** And its notes must be clearly closer to each other than to anything else: mean silhouette. */
export const MIN_SILHOUETTE = 0.25

/** Every pair's cosine similarity, n x n. */
export function similarities(vectors: readonly ArrayLike<number>[]): Float64Array {
  const n = vectors.length
  const sim = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vectors[i]!, vectors[j]!)
      sim[i * n + j] = s
      sim[j * n + i] = s
    }
  }
  return sim
}

/** A node of the average-linkage tree: formed at `height`, merged into its parent at `parentHeight`. */
type Node = { members: number[]; height: number; parentHeight: number | null; kids: Node[] }

/**
 * The whole average-linkage tree over cosine similarity. Nearest-neighbour
 * chain, O(n^2) time and memory: average linkage is reducible, which is what
 * makes the chain valid.
 */
function dendrogram(similarity: Float64Array, n: number): Node {
  const sim = Float64Array.from(similarity)
  const size = new Array<number>(n).fill(1)
  const node: Node[] = Array.from({ length: n }, (_, i) => ({ members: [i], height: 1, parentHeight: null, kids: [] }))
  const open = new Set<number>(Array.from({ length: n }, (_, i) => i))
  const chain: number[] = []
  while (open.size > 1) {
    if (chain.length === 0) chain.push(open.values().next().value!)
    const c = chain[chain.length - 1]!
    const previous = chain.length > 1 ? chain[chain.length - 2]! : -1
    let best = -1
    let bestSim = -Infinity
    for (const k of open) {
      if (k === c) continue
      const s = sim[c * n + k]!
      // Prefer the previous link of the chain on a tie, or the chain can cycle.
      if (s > bestSim || (s === bestSim && k === previous)) {
        best = k
        bestSim = s
      }
    }
    if (best !== previous) {
      chain.push(best)
      continue
    }
    // Reciprocal nearest neighbours: merge into c (Lance-Williams, average).
    chain.pop()
    chain.pop()
    for (const k of open) {
      if (k === c || k === best) continue
      const s = (size[c]! * sim[c * n + k]! + size[best]! * sim[best * n + k]!) / (size[c]! + size[best]!)
      sim[c * n + k] = s
      sim[k * n + c] = s
    }
    size[c]! += size[best]!
    node[c]!.parentHeight = bestSim
    node[best]!.parentHeight = bestSim
    node[c] = { members: [...node[c]!.members, ...node[best]!.members], height: bestSim, parentHeight: null, kids: [node[c]!, node[best]!] }
    open.delete(best)
  }
  return node[open.values().next().value!]!
}

/**
 * Per cluster, the mean silhouette of its notes: how much closer each is to
 * its own cluster than to the nearest other group - another cluster, or the
 * notes in none, taken together. Scale-free, so it means the same in a vault
 * of two subjects and a vault of fifty.
 */
export function silhouettes(similarity: Float64Array, n: number, clusters: readonly number[][]): number[] {
  const dist = (i: number, j: number): number => 1 - similarity[i * n + j]!
  const inAny = new Set(clusters.flat())
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !inAny.has(i))
  const mean = (i: number, group: readonly number[]): number => group.reduce((s, j) => s + dist(i, j), 0) / group.length
  return clusters.map((cluster, k) => {
    const others = [...clusters.filter((_, o) => o !== k), ...(rest.length > 0 ? [rest] : [])]
    let sum = 0
    for (const i of cluster) {
      const a = cluster.length < 2 ? 0 : cluster.reduce((s, j) => (j === i ? s : s + dist(i, j)), 0) / (cluster.length - 1)
      const b = others.length === 0 ? a : Math.min(...others.map((o) => mean(i, o)))
      sum += Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b)
    }
    return sum / cluster.length
  })
}

/**
 * Topics from similarities, with no global cut.
 *
 * A single threshold assumes something about how dense the vault is - a
 * percentile of pair similarity assumes same-topic pairs are rare, which a
 * vault of six subjects breaks. So each cluster is judged on its own:
 *
 *  1. Excess of mass over the average-linkage tree: a cluster of three or
 *     more is kept when it holds together longer (formed high, merged low)
 *     than its sub-clusters do in sum; otherwise its sub-clusters are.
 *  2. A kept cluster must also have mean silhouette >= MIN_SILHOUETTE. One
 *     that does not - typically two tight groups joined at a low similarity -
 *     is set aside and its sub-clusters compete again, worst first.
 *
 * Returns clusters as lists of indices, largest first; ties by first index.
 */
export function selectTopics(similarity: Float64Array, n: number): number[][] {
  if (n < MIN_TOPIC_SIZE) return []
  const root = dendrogram(similarity, n)
  const banned = new Set<Node>()
  const best = (node: Node): { score: number; picked: Node[] } => {
    const kids = node.kids.map(best)
    const sum = kids.reduce((s, k) => s + k.score, 0)
    const picked = kids.flatMap((k) => k.picked)
    if (node.members.length < MIN_TOPIC_SIZE || node.parentHeight === null || banned.has(node)) return { score: sum, picked }
    const life = node.height - node.parentHeight
    return life >= MIN_LIFETIME && life >= sum ? { score: life, picked: [node] } : { score: sum, picked }
  }
  for (;;) {
    const picked = best(root).picked
    const scores = silhouettes(similarity, n, picked.map((p) => p.members))
    const worst = scores.reduce((w, s, i) => (s < scores[w]! ? i : w), 0)
    if (picked.length === 0 || scores[worst]! >= MIN_SILHOUETTE) {
      return picked
        .map((p) => [...p.members].sort((a, b) => a - b))
        .sort((a, b) => b.length - a.length || a[0]! - b[0]!)
    }
    banned.add(picked[worst]!)
  }
}

const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? 0
}

/**
 * T_ASSIGN: how close the loosest members were at build time - the 5th
 * percentile of member-to-centroid similarity - so a note added later is as
 * close to its topic as the ones already there.
 */
export function assignThreshold(topics: readonly (readonly ArrayLike<number>[])[]): number {
  const sims: number[] = []
  for (const members of topics) {
    if (members.length === 0) continue
    const c = centroid(members)
    for (const m of members) sims.push(cosine(m, c))
  }
  return sims.length === 0 ? 1 : Math.round(quantile(sims, 0.05) * 1000) / 1000
}

/**
 * Which topics a note belongs to: the best if it clears T_ASSIGN and beats the
 * runner-up by 0.03, and the runner-up too if it also clears T_ASSIGN.
 */
export function assign(
  vector: ArrayLike<number>,
  centroids: readonly { id: string; vector: ArrayLike<number> }[],
  tAssign: number,
): string[] {
  const ranked = centroids.map((c) => ({ id: c.id, sim: cosine(vector, c.vector) })).sort((a, b) => b.sim - a.sim)
  const [first, second] = ranked
  if (first === undefined || first.sim < tAssign) return []
  if (second !== undefined && first.sim - second.sim < ASSIGN_MARGIN) return []
  return second !== undefined && second.sim >= tAssign && MAX_TOPICS_PER_NOTE > 1 ? [first.id, second.id] : [first.id]
}

export const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let common = 0
  for (const x of a) if (b.has(x)) common++
  const union = a.size + b.size - common
  return union === 0 ? 0 : common / union
}

/** The old topic a new cluster continues, if their members overlap by Jaccard >= 0.5. */
export function continues(
  cluster: ReadonlySet<string>,
  old: readonly { id: string; members: ReadonlySet<string> }[],
  taken: ReadonlySet<string>,
): string | null {
  let best: { id: string; overlap: number } | null = null
  for (const topic of old) {
    if (taken.has(topic.id)) continue
    const overlap = jaccard(cluster, topic.members)
    if (overlap >= KEEP_OVERLAP && (best === null || overlap > best.overlap)) best = { id: topic.id, overlap }
  }
  return best?.id ?? null
}
