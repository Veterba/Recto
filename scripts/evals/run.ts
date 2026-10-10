import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { conversationOf, readCases, type Case, type Kind } from './cases.ts'
import { languageOf, score, summarise, type Answered, type Scored } from './metrics.ts'
import { REPORT_VERSION, gb, pct, renderReport, resultLine, secs, type Harness, type Memory, type RunConfig } from './report.ts'
import {
  REAL_VAULT,
  REPO_STORE,
  allRuns,
  ROOT,
  appendEvalLog,
  collectGrades,
  findEvalsFolder,
  guard,
  modelSlug,
  newRunId,
  noteNames,
  noteName,
  previousRun,
  runLink,
  runPaths,
  writeVaultIndex,
} from './store.ts'

/**
 * npm run bots:eval [-- --vault <path>] [--cases <file>] [--only <kind>] [--model <tag>] [--label "<label>"] [--why "<reason>"]
 *
 * Puts every case to Recto through the app itself - the built app, started
 * with no window on a scratch copy of the vault, the same vault search, prompt
 * and model profile as the chat (src/main/bots/eval-mode.ts) - with the real
 * local model, then scores the answers and writes the run's report.
 *
 * Without --vault it runs the fixture vault and its cases; with --vault (always
 * copied first; the vault itself is never opened) the private cases. Either
 * way the run becomes one note in the real vault's evals folder
 * ("Eval <run id>", store.ts), its raw data goes to the vault's hidden
 * .recto/evals/, and it is added to the index and the eval log there.
 * --evals-vault <path> writes them to another vault (tests, a copy).
 */

const OLLAMA = 'http://127.0.0.1:11434'
const FIXTURE = path.join(ROOT, 'tests/bots/eval/fixture-vault')
const FIXTURE_CASES = path.join(ROOT, 'tests/bots/eval/cases.yaml')
const PRIVATE_CASES = path.join(ROOT, 'tests/bots/eval/private')
/** Below this many tokens/s on the speed check, the Mac is throttling. */
const MIN_SPEED = 5
/** Below this battery level, unless charging, the run does not start. */
const MIN_BATTERY = 20
/** Before the app reported its harness parts (stage 2 runs): none. */
const HARNESS: Harness = {}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const sh = (cmd: string, argv: string[]): string => {
  try {
    return execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

async function ollama<T>(route: string, body?: object): Promise<T | null> {
  try {
    const response = await fetch(`${OLLAMA}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    })
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** Swap in use, from `sysctl vm.swapusage` ("used = 1234.56M"). */
function swapUsed(): number | null {
  const m = /used = ([\d.]+)([KMG])/.exec(sh('sysctl', ['-n', 'vm.swapusage']))
  if (m === null) return null
  return Number(m[1]) * { K: 1e3, M: 1e6, G: 1e9 }[m[2] as 'K' | 'M' | 'G']
}

/** Resident memory of Ollama's processes, and of the process tree under `root`, in bytes. */
function residentNow(root: number): { ollama: number; app: number } {
  const rows = sh('ps', ['-axo', 'pid=,ppid=,rss=,comm='])
    .split('\n')
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)
      return m === null ? null : { pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, comm: m[4]! }
    })
  const procs = rows.filter((r): r is NonNullable<typeof r> => r !== null)
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const p of procs)
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid)
        grew = true
      }
  }
  return {
    ollama: procs.filter((p) => /ollama/i.test(p.comm)).reduce((s, p) => s + p.rss, 0),
    app: procs.filter((p) => tree.has(p.pid)).reduce((s, p) => s + p.rss, 0),
  }
}

/** A fresh copy of the vault to run on. The fixture's notes get their dates as file times, so "recent" means what it says. */
function copyVault(source: string, into: string, fixture: boolean): void {
  fs.cpSync(source, into, {
    recursive: true,
    preserveTimestamps: true,
    // The index is rebuilt from the notes; backups and trash are not notes. The evals folder is
    // the eval's own: its questions and earlier runs' answers would be found as notes.
    filter: (src) =>
      !/[\\/]\.recto[\\/](index\.db.*|backups|archive|evals)(?:$|[\\/])|[\\/]\.trash(?:$|[\\/])|[\\/]\.git(?:$|[\\/])/.test(src) &&
      !(src.split(/[\\/]/).at(-1)?.toLowerCase() === 'evals qwen'),
  })
  if (!fixture) return
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8')
        const date = /^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1] ?? /^(\d{4}-\d{2}-\d{2})/.exec(e.name)?.[1] ?? '2026-09-01'
        const when = new Date(`${date}T12:00:00`)
        fs.utimesSync(full, when, when)
      }
    }
  }
  walk(into)
}

/** Every note's name in the vault, for spotting notes an answer names without having read them. */
function titlesOf(vault: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.md')) out.push(e.name.replace(/\.md$/i, ''))
    }
  }
  walk(vault)
  return out
}

/** On battery and nearly empty, macOS slows everything down: the numbers would be wrong. Null when there is no battery. */
function batteryTooLow(): string | null {
  // "38%; charging; …", "2%; AC attached; not charging; …", "80%; discharging; …"
  const m = /(\d+)%;\s*([^;]+);(?:\s*([^;]+);)?/.exec(sh('pmset', ['-g', 'batt']))
  if (m === null) return null
  const level = Number(m[1])
  const state = `${m[2] ?? ''} ${m[3] ?? ''}`
  const charging = /\bcharging\b|charged|finishing/i.test(state) && !/not charging|discharging/i.test(state)
  return level < MIN_BATTERY && !charging ? `The battery is at ${level}% and not charging.` : null
}

/** How many notes in each language, by the language of their text. */
function languagesOf(vault: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.md')) {
        const lang = languageOf(fs.readFileSync(full, 'utf8').slice(0, 4000))
        counts[lang] = (counts[lang] ?? 0) + 1
      }
    }
  }
  walk(vault)
  return counts
}

/** Frozen copies of the real vault for private runs, one folder each (`private-2026-10-10`), named by the cases. */
const SNAPSHOTS = path.join(os.homedir(), 'Recto-eval-vaults')
const isPrivate = (): boolean => flag('--vault') !== undefined || args.includes('--private')

function loadCases(): { file: string; text: string; today: string | null; snapshot: string | null; cases: Case[] } {
  const explicit = flag('--cases')
  if (explicit !== undefined) {
    const text = fs.readFileSync(path.resolve(explicit), 'utf8')
    const read = readCases(text, path.basename(explicit, path.extname(explicit)))
    return { file: path.relative(ROOT, path.resolve(explicit)), text, ...read }
  }
  if (!isPrivate()) {
    const text = fs.readFileSync(FIXTURE_CASES, 'utf8')
    return { file: path.relative(ROOT, FIXTURE_CASES), text, ...readCases(text) }
  }
  const files = fs.existsSync(PRIVATE_CASES)
    ? fs
        .readdirSync(PRIVATE_CASES)
        // The held-out cases are run once, on purpose, with --cases: never with the rest, never tuned on.
        .filter((f) => /\.ya?ml$/i.test(f) && !/^heldout\./i.test(f))
        .sort()
    : []
  if (files.length === 0)
    throw new Error(`No private cases in ${path.relative(ROOT, PRIVATE_CASES)}/ - nothing to run on the vault copy. Pass --cases <file>.`)
  const texts = files.map((f) => fs.readFileSync(path.join(PRIVATE_CASES, f), 'utf8'))
  const read = files.map((f, i) => readCases(texts[i]!, path.basename(f, path.extname(f))))
  return {
    file: files.map((f) => path.relative(ROOT, path.join(PRIVATE_CASES, f))).join(', '),
    text: texts.join('\n---\n'),
    // The snapshot and its day: from the first file that names them.
    today: read.find((r) => r.today !== null)?.today ?? null,
    snapshot: read.find((r) => r.snapshot !== null)?.snapshot ?? null,
    cases: read.flatMap((r) => r.cases),
  }
}

async function main(): Promise<void> {
  const loaded = loadCases()
  // A private run reads the snapshot its cases name, never the live vault: the notes stay what the cases expect.
  const vaultArg =
    flag('--vault') ??
    (isPrivate() || loaded.snapshot !== null ? (loaded.snapshot === null ? undefined : path.join(SNAPSHOTS, loaded.snapshot)) : undefined)
  if (isPrivate() && vaultArg === undefined)
    throw new Error('The private cases name no snapshot (`snapshot:` in the YAML); pass --vault <snapshot>.')
  if (vaultArg !== undefined && path.resolve(vaultArg) === path.resolve(REAL_VAULT))
    throw new Error(`Private runs use a frozen snapshot in ${SNAPSHOTS}, not the live vault.`)
  if (vaultArg !== undefined && !fs.existsSync(vaultArg)) throw new Error(`No snapshot at ${vaultArg}.`)
  const fixture = vaultArg === undefined
  const model = flag('--model') ?? 'qwen3.5:9b'
  const label = flag('--label') ?? 'run'
  const only = flag('--only') as Kind | undefined
  const cases = loaded.cases.filter((c) => only === undefined || c.kind === only)
  if (cases.length === 0) throw new Error(`No cases${only === undefined ? '' : ` of kind ${only}`}.`)
  if (!fixture && path.resolve(vaultArg).startsWith(path.resolve(ROOT))) throw new Error('--vault must be a vault outside the repo.')

  // Fixture runs go to the repo (docs/evals); private runs, which hold the user's answers, only to the vault.
  const evalsVault = path.resolve(flag('--evals-vault') ?? (fixture ? REPO_STORE : REAL_VAULT))
  const evalsDir = evalsVault === REPO_STORE ? REPO_STORE : findEvalsFolder(evalsVault)
  const battery = batteryTooLow()
  if (battery !== null && !args.includes('--force')) throw new Error(`${battery} Timings would be wrong; charge first, or pass --force.`)

  // The model: installed, and alone in memory - every other model is unloaded first.
  const version = (await ollama<{ version: string }>('/api/version'))?.version ?? null
  if (version === null) throw new Error('Ollama is not running. Open the Ollama app, or run `ollama serve`.')
  const tags = (await ollama<{ models: { name: string }[] }>('/api/tags'))?.models.map((m) => m.name) ?? []
  if (!tags.includes(model.includes(':') ? model : `${model}:latest`))
    throw new Error(`${model} is not installed. Pull it first: ollama pull ${model}`)
  const loadedNow = (await ollama<{ models: { name: string }[] }>('/api/ps'))?.models.map((m) => m.name) ?? []
  for (const other of loadedNow.filter((n) => n !== model)) await ollama('/api/generate', { model: other, keep_alive: 0 })
  // The model itself too: one left loaded for hours under memory pressure is partly paged out and runs
  // at a third of its speed. Loaded fresh, the timings are the model's, not the swap's.
  if (loadedNow.includes(model)) await ollama('/api/generate', { model, keep_alive: 0 })

  // A Mac that is throttling (a flat battery, heat) runs the model at a tenth
  // of its speed, and every timing in the report would be wrong. Measured
  // first, kept in the report, and too slow stops the run unless --force.
  const bench = await ollama<{ eval_count: number; eval_duration: number }>('/api/generate', {
    model,
    prompt: 'Count from 1 to 40, comma separated.',
    stream: false,
    think: false,
    options: { num_predict: 120 },
  })
  const speed = bench === null || bench.eval_duration === 0 ? null : bench.eval_count / (bench.eval_duration / 1e9)
  console.log(`Speed check: ${speed?.toFixed(1) ?? '?'} tokens/s`)
  if (speed !== null && speed < MIN_SPEED && !args.includes('--force'))
    throw new Error(
      `The model runs at ${speed.toFixed(1)} tokens/s - the Mac is throttling (battery, heat?). Timings would be wrong; run again later, or pass --force.`,
    )

  // A scratch vault and profile; both go when the run is done.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-eval-'))
  const vault = path.join(scratch, 'vault')
  copyVault(fixture ? FIXTURE : path.resolve(vaultArg), vault, fixture)
  const out = path.join(scratch, 'results.jsonl')
  const jobPath = path.join(scratch, 'job.json')
  // --harness router=off,tools=on: switch pipeline parts for this run only.
  const harness = Object.fromEntries(
    (flag('--harness') ?? '')
      .split(',')
      .filter((p) => p.includes('='))
      .map((p) => {
        const [k, v] = p.split('=')
        return [k!.trim(), v!.trim() === 'on' || v!.trim() === 'true']
      }),
  )
  fs.writeFileSync(
    jobPath,
    JSON.stringify({
      vault,
      model,
      out,
      ...(loaded.today === null ? {} : { today: loaded.today }),
      harness,
      // Cards and loose-task readings carried from run to run (by content hash and model), outside the repo and the vault.
      cache: path.join(os.tmpdir(), 'recto-eval-cache', `${fixture ? 'fixture' : 'vault'}-${modelSlug(model)}.json`),
      cases: cases.map((c) => ({ id: c.id, messages: conversationOf(c) })),
    }),
  )

  fs.mkdirSync(path.join(os.tmpdir(), 'recto-eval-cache'), { recursive: true })
  const swapBefore = swapUsed()
  const require = createRequire(import.meta.url)
  const electron = require('electron') as unknown as string
  console.log(`Running ${cases.length} cases on ${model} (${fixture ? 'fixture vault' : 'vault copy'})…`)
  const child = spawn(
    electron,
    ['-r', path.join(ROOT, 'scripts/snapshot-isolate.cjs'), ROOT, `--user-data-dir=${path.join(scratch, 'profile')}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        RECTO_EVAL_JOB: jobPath,
        RECTO_ALLOW_REAL_VAULT: '1',
        OLLAMA_MAX_LOADED_MODELS: '1',
        RECTO_BOTS_MOCK: '',
        // The embedding model the installed app downloaded: the run's own profile has none.
        RECTO_MODEL_DIR: process.env['RECTO_MODEL_DIR'] ?? path.join(os.homedir(), 'Library/Application Support/Recto/models'),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  )
  const peak = { ollama: 0, app: 0, model: 0 }
  const sampler = setInterval(() => {
    const now = residentNow(child.pid ?? 0)
    peak.ollama = Math.max(peak.ollama, now.ollama)
    peak.app = Math.max(peak.app, now.app)
    void ollama<{ models: { name: string; size: number }[] }>('/api/ps').then((ps) => {
      for (const m of ps?.models ?? []) if (m.name === model) peak.model = Math.max(peak.model, m.size)
    })
    const done = fs.existsSync(out)
      ? fs
          .readFileSync(out, 'utf8')
          .split('\n')
          .filter((l) => l.includes('"type":"case"')).length
      : 0
    process.stdout.write(`\r  ${done}/${cases.length}`)
  }, 1000)
  const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)))
  clearInterval(sampler)
  process.stdout.write('\n')
  const swapAfter = swapUsed()

  const lines = fs.existsSync(out)
    ? fs
        .readFileSync(out, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { type: string } & Record<string, unknown>)
    : []
  const run = lines.find((l) => l.type === 'run') as
    | {
        system: string
        profile: unknown
        notes: number | null
        cpu: string
        ramBytes: number
        harness?: Harness
        build?: RunConfig['build']
      }
    | undefined
  const answered = new Map(lines.filter((l) => l.type === 'case').map((l) => [l['id'] as string, l as unknown as Answered]))
  if (code !== 0 || run === undefined)
    throw new Error(`The app's eval run failed (exit ${code}); ${answered.size} of ${cases.length} cases answered.`)

  const titles = titlesOf(vault)
  const rows: Scored[] = cases.map((c) => {
    const a = answered.get(c.id) ?? {
      id: c.id,
      context: [],
      answer: '',
      error: 'not answered (the run stopped)',
      ttftMs: null,
      totalMs: 0,
      prepareMs: 0,
      stats: null,
    }
    return { case: c, answered: a, scores: score(c, a, titles) }
  })

  const now = new Date()
  const runId = newRunId(evalsVault, label, now)
  const where = runPaths(evalsVault, evalsDir, model, runId)
  const previous = previousRun(allRuns(), model, fixture ? 'fixture' : 'copy')
  const memory: Memory = {
    ollamaPeakBytes: peak.ollama || null,
    appPeakBytes: peak.app || null,
    modelBytes: peak.model || null,
    swapBeforeBytes: swapBefore,
    swapAfterBytes: swapAfter,
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
  const config: RunConfig = {
    report_version: REPORT_VERSION,
    run_id: runId,
    label,
    date: now.toISOString(),
    model,
    profile: run.profile,
    harness: run.harness ?? HARNESS,
    git: {
      commit: sh('git', ['rev-parse', 'HEAD']),
      branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: sh('git', ['status', '--porcelain']) !== '',
    },
    app_version: packageJson.version,
    system: run.system,
    system_sha: sha(run.system),
    cases_file: loaded.file,
    cases_sha: sha(loaded.text),
    today: loaded.today,
    vault: {
      kind: fixture ? 'fixture' : 'copy',
      snapshot: fixture ? null : path.basename(path.resolve(vaultArg)),
      notes: run.notes,
      languages: languagesOf(vault),
    },
    machine: { chip: sh('sysctl', ['-n', 'machdep.cpu.brand_string']) || run.cpu, ram_bytes: run.ramBytes },
    ollama: {
      version,
      speed_check_tokens_per_sec: speed,
      one_model_loaded: `other models unloaded before the run (were: ${loadedNow.filter((n) => n !== model).join(', ') || 'none'})`,
    },
    memory,
    build: run.build ?? null,
    why: flag('--why') ?? null,
    note: path.relative(evalsVault, where.note).split(path.sep).join('/'),
  }

  // One note per run, with a name no other note in the vault has.
  if (noteNames(evalsVault).has(noteName(runId).normalize('NFC').toLowerCase()))
    throw new Error(`A note named "${noteName(runId)}" already exists in the vault; not writing over it.`)
  for (const target of [where.note, path.join(where.data, 'results.jsonl'), path.join(where.data, 'config.json')])
    guard(target, evalsVault, evalsDir, where)
  fs.mkdirSync(path.dirname(where.note), { recursive: true })
  fs.mkdirSync(where.data, { recursive: true })
  fs.writeFileSync(where.note, renderReport(config, rows, previous))
  fs.writeFileSync(path.join(where.data, 'results.jsonl'), `${rows.map((r) => JSON.stringify(resultLine(r))).join('\n')}\n`)
  fs.writeFileSync(path.join(where.data, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

  writeVaultIndex(evalsVault, evalsDir)
  const graded = collectGrades(evalsVault, evalsDir)

  const s = summarise(rows)
  appendEvalLog(
    evalsVault,
    evalsDir,
    [
      `## ${runId.slice(0, 16).replace(/(\d\d)-(\d\d)$/, '$1:$2')} — ${label} · ${model} · ${fixture ? 'fixture' : 'vault copy'}`,
      '',
      `- Why: ${config.why ?? '—'}`,
      `- Result: ${s.passed}/${s.cases} pass (${pct(s.passRate)}), recall@4 ${pct(s.recall4)}, TTFT p50 ${secs(s.ttftP50)}, ${s.tokensPerSec?.toFixed(1) ?? '—'} tokens/s, peak Ollama ${gb(memory.ollamaPeakBytes)}`,
      `- Report: ${runLink(runId)}${previous === null ? '' : ` · compared to ${runLink(previous.config.run_id)}`}`,
    ].join('\n'),
  )

  fs.rmSync(scratch, { recursive: true, force: true })
  console.log(
    `${s.passed}/${s.cases} pass, recall@4 ${pct(s.recall4)}, TTFT p50 ${secs(s.ttftP50)}.${graded > 0 ? ` ${graded} new grades collected.` : ''}`,
  )
  console.log(`Report: ${where.note}`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
