import fs from 'node:fs'
import path from 'node:path'
import { readGrades, fromLine, headline, pct, secs, type Grade, type Previous, type ResultLine, type RunConfig } from './report.ts'
import type { Scored } from './metrics.ts'

/**
 * Where eval runs are kept, and the files kept beside them.
 *
 * Fixture runs go to docs/evals/<run id>/ in the repo, listed in
 * docs/evals/README.md. Runs on a copy of the real vault, or with the private
 * cases, go to the vault's evals folder ("Evals Qwen", found by name), one
 * subfolder per model, listed in Evals.md there. The evals folder also holds
 * "Eval log.md" (every run, for reading in Recto) and graded.jsonl (every
 * graded answer: a future fine-tuning set, so never in the repo).
 *
 * In the vault, only that folder is ever written, and in it only new run
 * folders, Evals.md, Eval log.md and graded.jsonl; an older run is never
 * changed. `guard` enforces it.
 */

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const REPO_RUNS = path.join(ROOT, 'docs/evals')
/** The real vault, to find the evals folder in. Read only to find it; nothing else in it is touched. */
export const REAL_VAULT = process.env['RECTO_EVALS_VAULT'] ?? '/Users/veterba/Documents/Notes/Recto-vault'
const EVALS_FOLDER_NAME = 'evals qwen'

/** The evals folder: the one folder named "Evals Qwen" (any case) outside .recto/. Throws unless there is exactly one. */
export function findEvalsFolder(vault: string = REAL_VAULT): string {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.name.toLowerCase() === EVALS_FOLDER_NAME) found.push(full)
      else walk(full, depth + 1)
    }
  }
  walk(vault, 0)
  if (found.length !== 1)
    throw new Error(
      found.length === 0
        ? `No folder named "Evals Qwen" in ${vault}. Make one, or tell the runner where with --evals-dir.`
        : `More than one folder named "Evals Qwen": ${found.join(', ')}. Pass the right one with --evals-dir.`,
    )
  return found[0]!
}

/** A path the runner may write in the vault: inside the evals folder, and an older run never. */
export function guard(target: string, evalsDir: string, newRunDir: string | null): void {
  const rel = path.relative(evalsDir, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Refusing to write outside the evals folder: ${target}`)
  const top = new Set(['Evals.md', 'Eval log.md', 'graded.jsonl'])
  if (top.has(rel)) return
  if (newRunDir !== null && (target === newRunDir || !path.relative(newRunDir, target).startsWith('..'))) return
  throw new Error(`Refusing to write ${target}: only a new run folder, Evals.md, Eval log.md and graded.jsonl may be written.`)
}

/** "qwen3.5:9b" → "qwen3.5-9b", a folder name. */
export const modelSlug = (model: string): string => model.replace(/[:/\\]/g, '-')

const pad = (n: number): string => String(n).padStart(2, '0')
export const stamp = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`

/** "2026-10-03 14-05 — baseline", numbered if that folder is taken. */
export function newRunId(base: string, label: string, now: Date): string {
  const clean = label.replace(/[\\/:*?"<>|]/g, '-').trim() || 'run'
  const id = `${stamp(now)} — ${clean}`
  let n = 1
  let candidate = id
  while (fs.existsSync(path.join(base, candidate))) candidate = `${id} (${++n})`
  return candidate
}

export type StoredRun = { dir: string; config: RunConfig; lines: ResultLine[] }

/** Every run under `base` (one level of run folders, or two with model folders), oldest first. */
export function listRuns(base: string): StoredRun[] {
  const runs: StoredRun[] = []
  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      const config = path.join(full, 'config.json')
      if (fs.existsSync(config)) {
        try {
          runs.push({
            dir: full,
            config: JSON.parse(fs.readFileSync(config, 'utf8')) as RunConfig,
            lines: fs
              .readFileSync(path.join(full, 'results.jsonl'), 'utf8')
              .split('\n')
              .filter((l) => l.trim() !== '')
              .map((l) => JSON.parse(l) as ResultLine),
          })
        } catch {
          // A run folder half written by a crash: not a run.
        }
      } else if (depth < 1) visit(full, depth + 1)
    }
  }
  visit(base, 0)
  return runs.sort((a, b) => a.config.date.localeCompare(b.config.date))
}

export function gradesOf(dir: string): Map<string, Grade> {
  try {
    return readGrades(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'))
  } catch {
    return new Map()
  }
}

/** The run this one is compared to: the newest earlier run of the same model in the same place. */
export function previousRun(runs: readonly StoredRun[], model: string): Previous | null {
  const same = runs.filter((r) => r.config.model === model)
  const last = same.at(-1)
  if (last === undefined) return null
  return { config: last.config, rows: last.lines.map(fromLine), grades: gradesOf(last.dir) }
}

const rowFor = (run: StoredRun, link: string): string => {
  const rows: Scored[] = run.lines.map(fromLine)
  const h = headline(rows)
  const grades = [...gradesOf(run.dir).values()]
  const share = grades.length === 0 ? '—' : `${pct(grades.filter((g) => g.grade === 'good').length / grades.length)} of ${grades.length}`
  return `| ${run.config.run_id.slice(0, 16).replace(/(\d\d)-(\d\d)$/, '$1:$2')} | ${run.config.model} | ${run.config.label} | ${pct(h.recall4)} | ${pct(h.passRate)} | ${share} | ${secs(h.ttftP50)} | ${link} |`
}

const TABLE_HEAD = ['| Date | Model | Label | recall@4 | Pass | Graded good | TTFT p50 | Report |', '|---|---|---|---|---|---|---|---|']

export function writeRepoIndex(): void {
  const runs = listRuns(REPO_RUNS).reverse()
  const lines = [
    '# Recto evals on the fixture vault',
    '',
    'Every `npm run bots:eval` on the fixture vault (`tests/bots/eval/fixture-vault`, cases in `tests/bots/eval/cases.yaml`), newest first. The runner rewrites this table; the format is described in each report ("Recto Eval Report v1").',
    '',
    ...TABLE_HEAD,
    ...runs.map((r) => rowFor(r, `[report](${encodeURI(`./${path.basename(r.dir)}/report.md`)})`)),
    '',
  ]
  fs.mkdirSync(REPO_RUNS, { recursive: true })
  fs.writeFileSync(path.join(REPO_RUNS, 'README.md'), lines.join('\n'))
}

/** A wikilink to a file in the vault, by its vault-relative path. */
export const wikilink = (vault: string, file: string, label: string): string =>
  `[[${path.relative(vault, file).split(path.sep).join('/').replace(/\.md$/i, '')}|${label}]]`

export function writeVaultIndex(evalsDir: string, vault: string = REAL_VAULT): void {
  const runs = listRuns(evalsDir).reverse()
  const target = path.join(evalsDir, 'Evals.md')
  guard(target, evalsDir, null)
  const lines = [
    '# Evals',
    '',
    'Recto eval runs on a copy of this vault and on the private cases, newest first, one folder per model. Written by `npm run bots:eval`; tick good / bad in a report to grade it.',
    '',
    ...TABLE_HEAD,
    ...runs.map((r) => rowFor(r, wikilink(vault, path.join(r.dir, 'report.md'), 'report'))),
    '',
  ]
  fs.writeFileSync(target, lines.join('\n'))
}

/** Add an entry to "Eval log.md", creating it with a title the first time. */
export function appendEvalLog(evalsDir: string, entry: string): void {
  const target = path.join(evalsDir, 'Eval log.md')
  guard(target, evalsDir, null)
  if (!fs.existsSync(target))
    fs.writeFileSync(
      target,
      '# Eval log\n\nEvery eval run, newest at the bottom: what was run, why, the result in one line, and the report.\n',
    )
  fs.appendFileSync(target, `\n${entry.trim()}\n`)
}

export type GradedLine = {
  question: string
  messages: ResultLine['messages']
  context: string[]
  answer: string
  model: string
  grade: 'good' | 'bad'
  note: string
  source: 'report' | 'chat'
  date: string
  run_id: string
  case_id: string
}

/**
 * Every grade ticked in any report under `bases` and not yet in graded.jsonl,
 * appended to it. Append-only: a grade already there is never rewritten.
 * Returns how many were added.
 */
export function collectGrades(evalsDir: string, bases: readonly string[]): number {
  const target = path.join(evalsDir, 'graded.jsonl')
  guard(target, evalsDir, null)
  const have = new Set<string>()
  if (fs.existsSync(target))
    for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const g = JSON.parse(line) as GradedLine
        have.add(`${g.run_id}\u0000${g.case_id}`)
      } catch {
        // Not ours to fix.
      }
    }
  const added: string[] = []
  for (const base of bases)
    for (const run of listRuns(base)) {
      const grades = gradesOf(run.dir)
      for (const line of run.lines) {
        const g = grades.get(line.id)
        if (g === undefined || have.has(`${run.config.run_id}\u0000${line.id}`)) continue
        const entry: GradedLine = {
          question: line.question,
          messages: line.messages,
          context: line.context.map((c) => c.title),
          answer: line.answer,
          model: run.config.model,
          grade: g.grade,
          note: g.note,
          source: 'report',
          date: new Date().toISOString(),
          run_id: run.config.run_id,
          case_id: line.id,
        }
        added.push(JSON.stringify(entry))
      }
    }
  if (added.length > 0) fs.appendFileSync(target, `${added.join('\n')}\n`)
  return added.length
}
