import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEncoder, DIMS, type Encoder } from '../src/embedder/encoder'
import { excludedFolders, isEligible } from '../src/main/autolinks/eligible'
import { modelPresent } from '../src/main/autolinks/model'
import { chunk, chunkInput, countWords, linkShare, ownLines, ownText, templateLines } from '../src/main/autolinks/text'
import { selectTopics, similarities } from '../src/main/topics/cluster'
import { dictionary } from '../src/main/topics/dictionary'
import { isEnglishNoun, lemmatizer } from '../src/main/topics/lemma'
import { language, nameable, nameCluster, nameText, vaultLanguage, type Lang } from '../src/main/topics/naming'
import { centre, centroid, evenly, MAX_CHUNKS, noteVector, vaultMean } from '../src/main/topics/vectors'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '../src/renderer/core/templates'

/**
 * Topics on whole vaults, the way the app finds them: own text, chunks,
 * vectors centred on the vault, then selectTopics.
 *
 * Everything here is inside the repo. The fixture vault always runs with a
 * deterministic embedder, and with EmbeddingGemma only when RECTO_MODEL_DIR
 * points at the model. The labelled sets are two real vaults reduced to what
 * clustering needs and nothing that says what the notes are: opaque positions,
 * the subjects a person gave them, and the notes' pairwise similarity.
 */

const MODEL_DIR = process.env['RECTO_MODEL_DIR'] ?? null

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : [],
  )

/** Hashed bag of words: topical enough for notes that share vocabulary, and deterministic. */
const bagOfWords: Encoder = async (texts) =>
  texts.map((text) => {
    const v = new Float32Array(DIMS)
    for (const word of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) {
      let h = 2166136261
      for (const c of word.slice(0, 6)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
      v[(h >>> 0) % DIMS]! += 1
    }
    const n = Math.hypot(...v) || 1
    return v.map((x) => x / n)
  })

/** Eligible notes and their centred note vectors, as the app would compute them. */
async function vaultVectors(
  root: string,
  templates: TemplateSettings,
  encode: Encoder,
): Promise<{ paths: string[]; vectors: Float32Array[]; mean: Float32Array; texts: string[] }> {
  const all = walk(root).map((p) => path.relative(root, p).split(path.sep).join('/'))
  const excluded = excludedFolders(templates, [])
  const template = templateLines(all.filter((p) => p.startsWith(`${templates.folder}/`)).map((p) => fs.readFileSync(path.join(root, p), 'utf8')))
  const chunksOf = new Map<string, Float32Array[]>()
  const textOf = new Map<string, string>()
  for (const p of all.sort()) {
    if (!isEligible(p, excluded)) continue
    const text = fs.readFileSync(path.join(root, p), 'utf8')
    const lines = ownLines(text, template)
    if (linkShare(text, template) > 0.5 || countWords(ownText(lines)) < 60) continue
    // Only the chunks a note vector would use: at most 48, evenly spaced.
    const inputs = chunk(lines).map(chunkInput)
    chunksOf.set(p, await encode(evenly(inputs.length, MAX_CHUNKS).map((i) => inputs[i]!)))
    textOf.set(p, text)
  }
  const mean = vaultMean([...chunksOf.values()].flat(), DIMS)
  const paths = [...chunksOf.keys()].filter((p) => chunksOf.get(p)!.length > 0)
  return { paths, vectors: paths.map((p) => noteVector(chunksOf.get(p)!, mean)!), mean, texts: paths.map((p) => textOf.get(p)!) }
}

/** Share of topics whose members all come from one folder. */
const purity = (topics: string[][]): number =>
  topics.filter((t) => new Set(t.map((p) => p.slice(0, p.indexOf('/')))).size === 1).length / Math.max(1, topics.length)

const FIXTURE = path.join(__dirname, 'fixtures/topics-vault')
const RECORDED = path.join(__dirname, 'fixtures/topics-vault-vectors.json')
const FIXTURE_TEMPLATES = { ...DEFAULT_TEMPLATE_SETTINGS, folder: 'Template', daily: { enabled: true, folder: 'Daily', template: null } }

/**
 * The app's whole pipeline on the fixture vault: centred note vectors, topics,
 * and their names (candidates, rerank against the centroid). `encode` embeds
 * both the chunks and the candidate words, as the embedder does.
 */
async function fixturePipeline(encode: Encoder): Promise<{ topics: string[][]; names: (string | null)[]; paths: string[] }> {
  const { paths, vectors, mean, texts } = await vaultVectors(FIXTURE, FIXTURE_TEMPLATES, encode)
  const clusters = selectTopics(similarities(vectors), vectors.length)
  const lem = await lemmatizer(path.join(__dirname, '../resources/dictionaries'))
  const notes = texts.map((text) => {
    const prose = nameText(text)
    const lang = language(prose)
    return { lang, prose, terms: lem(prose, lang).filter((w) => nameable(w, lang)) }
  })
  const counts: Partial<Record<Lang, number>> = {}
  for (const n of notes) counts[n.lang] = (counts[n.lang] ?? 0) + 1
  const taken = new Set<string>()
  const names: (string | null)[] = []
  for (const cluster of clusters) {
    const named = await nameCluster({
      members: cluster.map((i) => notes[i]!),
      vault: notes.map((n) => n.terms),
      vaultLang: vaultLanguage(counts, null)!,
      center: centroid(cluster.map((i) => vectors[i]!)),
      taken,
      embed: async (words) => (await encode(words)).map((v) => centre(v, mean)),
      translate: dictionary(path.join(__dirname, '../resources/dictionaries')).translate,
      isNoun: (w, l) => l !== 'en' || isEnglishNoun(w),
    })
    if (named.name !== null) taken.add(named.name.toLowerCase())
    names.push(named.name)
  }
  return { topics: clusters.map((c) => c.map((i) => paths[i]!)), names, paths }
}

/** EmbeddingGemma's vectors for the fixture, recorded once: every chunk and word the pipeline embeds. */
const replay = (): Encoder => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8')) as Record<string, number[]>
  return async (texts) =>
    texts.map((t) => {
      const v = recorded[t]
      if (v === undefined) throw new Error(`not recorded: ${JSON.stringify(t.slice(0, 60))} - re-record with RECTO_RECORD_FIXTURE=1`)
      return Float32Array.from(v)
    })
}

/** The live model, writing what it embeds to the recording when RECTO_RECORD_FIXTURE=1. */
async function live(): Promise<Encoder> {
  const encode = await createEncoder(MODEL_DIR!)
  if (process.env['RECTO_RECORD_FIXTURE'] !== '1') return encode
  const seen: Record<string, number[]> = {}
  return async (texts) => {
    const out = await encode(texts)
    texts.forEach((t, i) => (seen[t] = [...out[i]!].map((x) => Math.round(x * 1e5) / 1e5)))
    fs.writeFileSync(RECORDED, JSON.stringify(seen) + '\n')
    return out
  }
}

/** Six subjects become six pure topics; five are named - Money's notes share only one noun. */
function expectFixtureTopics({ topics, names }: { topics: string[][]; names: (string | null)[] }): void {
  console.log(`fixture: ${topics.map((t, i) => `${t[0]!.split('/')[0]} ${t.length} → ${names[i] ?? '(no name)'}`).join(', ')}`)
  expect(topics).toHaveLength(6)
  expect(purity(topics)).toBe(1)
  expect(topics.every((t) => t.length === 4)).toBe(true)
  const unnamed = topics.filter((_, i) => names[i] === null).map((t) => t[0]!.split('/')[0])
  expect(unnamed).toEqual(['Money'])
}

describe('topics on the fixture vault', () => {
  it('groups notes by subject and leaves out daily notes and templates (deterministic embedder)', async () => {
    const { topics, paths } = await vaultVectors(FIXTURE, FIXTURE_TEMPLATES, bagOfWords).then((v) => ({
      paths: v.paths,
      topics: selectTopics(similarities(v.vectors), v.vectors.length).map((c) => c.map((i) => v.paths[i]!)),
    }))
    // A crude stand-in for the model: this checks the pipeline, not the quality. Hashed
    // words barely tell these short notes apart (silhouette 0.05-0.2 per subject), so
    // the selection rightly keeps only what is clear; the recorded model is the quality test.
    expect(paths).toHaveLength(24)
    expect(topics.length).toBeGreaterThanOrEqual(1)
    expect(purity(topics)).toBe(1)
  })

  it('finds all six subjects and names five (EmbeddingGemma, recorded)', async () => {
    expectFixtureTopics(await fixturePipeline(replay()))
  })

  it.skipIf(MODEL_DIR === null || !modelPresent(MODEL_DIR))(
    'the same with the live model',
    async () => {
      expectFixtureTopics(await fixturePipeline(await live()))
    },
    180_000,
  )
})

type Labelled = { subjects: string[][]; ambiguous: string[][]; similarity: number[][] }

/**
 * Pairs: "same" if the notes share a subject; "ambiguous" if their subjects
 * are one concept in another language or context (string methods in JS and in
 * Python) - left out of every measure; "different" otherwise.
 */
function measure(set: Labelled, topics: number[][]) {
  const n = set.subjects.length
  const relation = (i: number, j: number): 'same' | 'ambiguous' | 'different' => {
    const [a, b] = [set.subjects[i]!, set.subjects[j]!]
    if (a.some((s) => b.includes(s))) return 'same'
    if (a.some((x) => b.some((y) => set.ambiguous.some((f) => f.includes(x) && f.includes(y))))) return 'ambiguous'
    return 'different'
  }
  const topicOf = new Map<number, number>()
  topics.forEach((c, t) => c.forEach((i) => topicOf.set(i, t)))
  let together = 0
  let right = 0
  let same = 0
  let ambiguous = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = relation(i, j)
      if (r === 'ambiguous') {
        ambiguous++
        continue
      }
      const joined = topicOf.has(i) && topicOf.get(i) === topicOf.get(j)
      if (r === 'same') same++
      if (joined) together++
      if (joined && r === 'same') right++
    }
  }
  // A topic is right when no two of its notes are "different".
  const precise = topics.filter((c) => c.every((i) => c.every((j) => i === j || relation(i, j) !== 'different')))
  const counts = new Map<string, number>()
  set.subjects.flat().forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1))
  const subjects = [...counts].filter(([, k]) => k >= 3).map(([s]) => s)
  const found = subjects.filter((s) => precise.some((c) => c.filter((i) => set.subjects[i]!.includes(s)).length * 2 > c.length))
  return {
    pairPrecision: together === 0 ? 1 : right / together,
    pairRecall: same === 0 ? 0 : right / same,
    topicPrecision: topics.length === 0 ? 1 : precise.length / topics.length,
    topicRecall: subjects.length === 0 ? 0 : found.length / subjects.length,
    ambiguous,
    topics: topics.length,
    covered: topics.flat().length,
  }
}

describe('the labelled sets (in the repo)', () => {
  for (const [name, minTopicPrecision] of [
    ['vault-a', 1],
    ['vault-b', 2 / 3],
  ] as const) {
    it(`${name}: topics are right before they are many`, () => {
      const set = JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/topic-labels/${name}.json`), 'utf8')) as Labelled
      const n = set.subjects.length
      const topics = selectTopics(Float64Array.from(set.similarity.flat()), n)
      const m = measure(set, topics)
      console.log(
        `${name}: ${m.topics} topics over ${m.covered}/${n} notes; pairs P ${m.pairPrecision.toFixed(2)} R ${m.pairRecall.toFixed(2)}; topics P ${m.topicPrecision.toFixed(2)} R ${m.topicRecall.toFixed(2)}; ${m.ambiguous} ambiguous pairs left out`,
      )
      expect(m.topics).toBeGreaterThan(0)
      expect(m.topicPrecision).toBeGreaterThanOrEqual(minTopicPrecision)
    })
  }
})
