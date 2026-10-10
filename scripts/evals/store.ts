import fs from 'node:fs'
import path from 'node:path'
import {
  readGrades,
  fromLine,
  headline,
  pct,
  secs,
  snapshotName,
  type Grade,
  type Previous,
  type ResultLine,
  type RunConfig,
} from './report.ts'
import type { Scored } from './metrics.ts'

/**
 * Where eval runs are kept, and the files kept beside them.
 *
 * Fixture runs live in the repo, `docs/evals/` (the fixture vault is
 * synthetic, so its answers may be committed): `docs/evals/<model>/Eval <run id>.md`,
 * raw data in `docs/evals/data/<run id>/`, and the folder's own index and log.
 *
 * Private runs are ONE note each in the vault's evals folder
 * ("Evals Qwen", found by name): `Evals Qwen/<model>/Eval <run id>.md`, a name
 * unique in the whole vault so it can be linked as [[Eval <run id>]]. Its raw
 * data (results.jsonl, config.json) goes to `<vault>/.recto/evals/<run id>/`:
 * hidden from the tree, never in the repo - it holds the answers. The folder
 * also holds "Recto evals.md" (the index), "Eval log.md" (every run, for
 * reading in Recto); graded.jsonl (every graded answer) is raw data too.
 *
 * Only those are ever written, an older run never. `guard` enforces it.
 */

export const ROOT = path.resolve(import.meta.dirname, '../..')
/** The real vault, whose evals folder the runs go to. Only that folder and .recto/evals are written. */
export const REAL_VAULT = process.env['RECTO_EVALS_VAULT'] ?? '/Users/veterba/Documents/Notes/Recto-vault'
const EVALS_FOLDER_NAME = 'evals qwen'
/** The raw data of every private run, inside the vault, hidden. */
export const DATA_DIR = path.join('.recto', 'evals')
/** The fixture runs' store: the repo's docs/evals, which is its own evals folder. */
export const REPO_STORE = path.join(ROOT, 'docs', 'evals')
/** Where a store keeps its runs' raw data: hidden in a vault, `data/` in the repo. */
export const dataDirOf = (vault: string): string =>
  path.resolve(vault) === path.resolve(REPO_STORE) ? path.join(vault, 'data') : path.join(vault, DATA_DIR)
export const INDEX_NOTE = 'Recto evals.md'
export const LOG_NOTE = 'Eval log.md'

/** The one folder named "Evals Qwen" (any case) outside .recto/. Throws unless there is exactly one. */
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
        ? `No folder named "Evals Qwen" in ${vault}. Make one, or tell the runner where with --evals-vault.`
        : `More than one folder named "Evals Qwen": ${found.join(', ')}.`,
    )
  return found[0]!
}

/** "qwen3.5:9b" → "qwen3.5-9b", a folder name. */
export const modelSlug = (model: string): string => model.replace(/[:/\\]/g, '-')

const pad = (n: number): string => String(n).padStart(2, '0')
export const stamp = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`

/** A run's note name: "Eval 2026-10-03 17-53 — B final". */
export const noteName = (runId: string): string => `Eval ${runId}`

/** Every note name in the vault (file names without .md), lowercased, for the uniqueness rule. */
export function noteNames(vault: string): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith('.md')) out.add(e.name.slice(0, -3).normalize('NFC').toLowerCase())
    }
  }
  walk(vault)
  return out
}

/** "2026-10-03 14-05 — baseline", numbered when that name is taken anywhere in the vault. */
export function newRunId(vault: string, label: string, now: Date): string {
  const clean = label.replace(/[\\/:*?"<>|]/g, '-').trim() || 'run'
  const id = `${stamp(now)} — ${clean}`
  const taken = fs.existsSync(vault) ? noteNames(vault) : new Set<string>()
  const free = (candidate: string): boolean =>
    !taken.has(noteName(candidate).normalize('NFC').toLowerCase()) && !fs.existsSync(path.join(dataDirOf(vault), candidate))
  let n = 1
  let candidate = id
  while (!free(candidate)) candidate = `${id} (${++n})`
  return candidate
}

/** Where a run is written: its note and its raw data folder. */
export type RunPaths = { id: string; note: string; data: string }

export const runPaths = (vault: string, evalsDir: string, model: string, id: string): RunPaths => ({
  id,
  note: path.join(evalsDir, modelSlug(model), `${noteName(id)}.md`),
  data: path.join(dataDirOf(vault), id),
})

const inside = (dir: string, target: string): boolean => {
  const rel = path.relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * A path the runner may write: the index and the log in the evals folder,
 * graded.jsonl in the data folder, and the new run's note and data. Anything
 * else - an older run, a note elsewhere in the vault - throws.
 */
export function guard(target: string, vault: string, evalsDir: string, run: RunPaths | null): void {
  const t = path.resolve(target)
  if (t === path.resolve(evalsDir, INDEX_NOTE) || t === path.resolve(evalsDir, LOG_NOTE)) return
  if (t === path.resolve(dataDirOf(vault), 'graded.jsonl')) return
  if (run !== null && (t === path.resolve(run.note) || inside(path.resolve(run.data), t))) return
  throw new Error(
    `Refusing to write ${target}: only a new run's note and data, ${INDEX_NOTE}, ${LOG_NOTE} and graded.jsonl may be written.`,
  )
}

export type StoredRun = { data: string; note: string; config: RunConfig; lines: ResultLine[] }

/** Every run in the vault's data folder, oldest first. */
export function listRuns(vault: string): StoredRun[] {
  const base = dataDirOf(vault)
  const runs: StoredRun[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(base, e.name)
    try {
      const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as RunConfig
      runs.push({
        data: dir,
        note: path.join(vault, config.note ?? ''),
        config,
        lines: fs
          .readFileSync(path.join(dir, 'results.jsonl'), 'utf8')
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => JSON.parse(l) as ResultLine),
      })
    } catch {
      // Half written by a crash: not a run.
    }
  }
  return runs.sort((a, b) => a.config.date.localeCompare(b.config.date))
}

/** The grades ticked in a run's note. */
export function gradesOf(run: Pick<StoredRun, 'note'>): Map<string, Grade> {
  try {
    return readGrades(fs.readFileSync(run.note, 'utf8'))
  } catch {
    return new Map()
  }
}

/** The run this one is compared to: the newest earlier run of the same model on the same kind of vault. */
export function previousRun(runs: readonly StoredRun[], model: string, vaultKind: 'fixture' | 'copy'): Previous | null {
  const last = runs.filter((r) => r.config.model === model && r.config.vault.kind === vaultKind).at(-1)
  if (last === undefined) return null
  return { config: last.config, rows: last.lines.map(fromLine), grades: gradesOf(last) }
}

/** Runs from both stores, oldest first: what a comparison can reach. */
export const allRuns = (vault: string = REAL_VAULT): StoredRun[] =>
  [...listRuns(REPO_STORE), ...listRuns(vault)].sort((a, b) => a.config.date.localeCompare(b.config.date))

/** A link to a run's note: by its name, never its path. */
export const runLink = (runId: string): string => `[[${noteName(runId)}]]`

const TABLE_HEAD = [
  '| Date | Model | Vault | Label | recall@4 | Pass | Graded good | TTFT p50 | Report |',
  '|---|---|---|---|---|---|---|---|---|',
]

const rowFor = (run: StoredRun): string => {
  const rows: Scored[] = run.lines.map(fromLine)
  const h = headline(rows)
  const grades = [...gradesOf(run).values()]
  const share = grades.length === 0 ? '—' : `${pct(grades.filter((g) => g.grade === 'good').length / grades.length)} of ${grades.length}`
  return `| ${run.config.run_id.slice(0, 16).replace(/(\d\d)-(\d\d)$/, '$1:$2')} | ${run.config.model} | ${snapshotName(run.config)} | ${run.config.label} | ${pct(h.recall4)} | ${pct(h.passRate)} | ${share} | ${secs(h.ttftP50)} | ${runLink(run.config.run_id)} |`
}

/** "Recto evals.md": every run, newest first. */
export function writeVaultIndex(vault: string, evalsDir: string): void {
  const runs = listRuns(vault).reverse()
  const target = path.join(evalsDir, INDEX_NOTE)
  guard(target, vault, evalsDir, null)
  const lines = [
    '# Recto evals',
    '',
    path.resolve(vault) === path.resolve(REPO_STORE)
      ? 'Every fixture run of `npm run bots:eval`, newest first (private runs are in the vault). Written by the runner.'
      : "Every private run of `npm run bots:eval -- --private`, newest first (fixture runs are in the repo, docs/evals). Written by the runner; tick good / bad in a run's note to grade it.",
    '',
    ...TABLE_HEAD,
    ...runs.map(rowFor),
    '',
  ]
  fs.writeFileSync(target, lines.join('\n'))
}

/** Add an entry to "Eval log.md", creating it with a title the first time. */
export function appendEvalLog(vault: string, evalsDir: string, entry: string): void {
  const target = path.join(evalsDir, LOG_NOTE)
  guard(target, vault, evalsDir, null)
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
 * Every grade ticked in any run's note and not yet in graded.jsonl,
 * appended to it. Append-only: a grade already there is never rewritten.
 * Returns how many were added.
 */
export function collectGrades(vault: string, evalsDir: string): number {
  const target = path.join(dataDirOf(vault), 'graded.jsonl')
  guard(target, vault, evalsDir, null)
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
  {
    for (const run of listRuns(vault)) {
      const grades = gradesOf(run)
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
  }
  if (added.length > 0) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(target, `${added.join('\n')}\n`)
  }
  return added.length
}
