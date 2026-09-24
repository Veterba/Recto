import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEncoder, type Encoder } from '../src/embedder/encoder'
import { normalizeName, parseNote, resolveLink } from '../src/indexer/parse'
import { collectTrials } from '../src/main/autolinks/calibrate'
import { excludedFolders, isEligible } from '../src/main/autolinks/eligible'
import { modelPresent } from '../src/main/autolinks/model'
import { calibrationReport, compareVectors, CANDIDATES, PRECISION_TARGET } from '../src/main/autolinks/score'
import { chunk, chunkInput, countWords, noteTitle, ownLines, ownText, templateLines, titleInput } from '../src/main/autolinks/text'
import { DEFAULT_TEMPLATE_SETTINGS } from '../src/renderer/core/templates'

/**
 * A fixture vault with known links -> calibrate -> the chosen T_ADD has
 * precision >= 0.7. Run twice: with a deterministic bag-of-words embedder,
 * which always runs and checks the pipeline, and with the real model when it
 * is on disk, which checks the numbers.
 */

const ROOT = path.join(__dirname, 'fixtures/autolinks-vault')
const MODEL_DIR = process.env['RECTO_MODEL_DIR'] ?? path.join(os.homedir(), 'Library/Application Support/Recto/models')

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : [],
  )

/** Hashed bag of words: topical enough for notes that share vocabulary, and deterministic. */
const bagOfWords: Encoder = async (texts) =>
  texts.map((text) => {
    const v = new Float32Array(256)
    for (const word of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) {
      let h = 2166136261
      for (const c of word.slice(0, 6)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
      v[(h >>> 0) % 256]! += 1
    }
    const n = Math.hypot(...v) || 1
    return v.map((x) => x / n)
  })

async function calibrateFixture(encode: Encoder) {
  const all = walk(ROOT).map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
  const allSet = new Set(all)
  const byName = new Map<string, string[]>()
  for (const p of all) {
    const key = normalizeName(p.slice(p.lastIndexOf('/') + 1))
    byName.set(key, [...(byName.get(key) ?? []), p])
  }
  const templates = { ...DEFAULT_TEMPLATE_SETTINGS, folder: 'Template', daily: { enabled: true, folder: 'Daily', template: null } }
  const excluded = excludedFolders(templates, [])
  const eligible = all.filter((p) => isEligible(p, excluded))
  const text = new Map(all.map((p) => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]))
  const template = templateLines(all.filter((p) => p.startsWith('Template/')).map((p) => text.get(p)!))
  const links = (p: string): Set<string> =>
    new Set(parseNote(text.get(p)!).links.flatMap((l) => resolveLink(l.target, byName, allSet) ?? []))

  const vectors = new Map<string, { chunks: Float32Array[]; title: Float32Array }>()
  for (const p of eligible) {
    const chunks = chunk(ownLines(text.get(p)!, template)).map(chunkInput)
    const [title, ...rest] = await encode([titleInput(p, text.get(p)!), ...chunks])
    vectors.set(p, { chunks: rest, title: title! })
  }

  const inDegree = new Map<string, number>()
  for (const p of all) for (const t of links(p)) inDegree.set(t, (inDegree.get(t) ?? 0) + 1)

  const trials = await collectTrials({
    eligible,
    manual: (p) => new Set([...links(p)].filter((t) => t !== p && eligible.includes(t))),
    source: (p, hidden) => {
      const hiddenName = noteTitle(hidden)
      const stripped = text.get(p)!.replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, (whole, t: string) => (t.trim() === hiddenName ? '' : whole))
      const own = ownText(ownLines(stripped, template))
      return countWords(own) < 60 ? null : { ownText: own, tags: new Set(), out: new Set([...links(p)].filter((t) => t !== hidden)) }
    },
    target: async (p) => ({ names: [noteTitle(p)], tags: new Set(), out: links(p), inDegree: inDegree.get(p) ?? 0 }),
    rejected: () => false,
    skip: () => false,
    similar: async (source, allowed) => {
      const s = vectors.get(source)!
      return allowed
        .map((t) => ({ path: t, sem: compareVectors(s.chunks, [...vectors.get(t)!.chunks, vectors.get(t)!.title]).sem }))
        .sort((a, b) => b.sem - a.sem)
        .slice(0, CANDIDATES)
    },
  })
  return { report: calibrationReport(trials, 0), eligible }
}

function expectCalibrated(report: ReturnType<typeof calibrationReport>): void {
  expect(report.links).toBeGreaterThanOrEqual(20)
  expect(report.chosen).not.toBeNull()
  const row = report.rows.find((r) => r.threshold === report.chosen)!
  expect(row.precision).toBeGreaterThanOrEqual(PRECISION_TARGET)
  expect(row.recall).toBeGreaterThan(0)
}

describe('calibration on a fixture vault', () => {
  it('never offers the daily note or the template as a source or a target', async () => {
    const { eligible } = await calibrateFixture(bagOfWords)
    expect(eligible).toHaveLength(24)
    expect(eligible.some((p) => p.startsWith('Daily/') || p.startsWith('Template/'))).toBe(false)
  })

  it('finds a threshold with precision >= 0.7 (deterministic embedder)', async () => {
    expectCalibrated((await calibrateFixture(bagOfWords)).report)
  })

  it.skipIf(!modelPresent(MODEL_DIR))(
    'finds a threshold with precision >= 0.7 (EmbeddingGemma)',
    async () => {
      const { report } = await calibrateFixture(await createEncoder(MODEL_DIR))
      const row = report.rows.find((r) => r.threshold === report.chosen)
      console.log(`EmbeddingGemma: T_ADD ${report.chosen} precision ${row?.precision.toFixed(2)} recall ${row?.recall.toFixed(2)} on ${report.links} links`)
      expectCalibrated(report)
    },
    120_000,
  )
})
