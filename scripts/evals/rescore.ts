import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { score } from './metrics.ts'
import { fromLine, renderReport, resultLine } from './report.ts'
import {
  REPO_STORE,
  ROOT,
  allRuns,
  appendEvalLog,
  findEvalsFolder,
  guard,
  listRuns,
  newRunId,
  noteName,
  noteNames,
  previousRun,
  realVault,
  runLink,
  runPaths,
  stamp,
  writeVaultIndex,
} from './store.ts'

/**
 * Score a fixture run again from what it stored (answers, contexts, the
 * prompts), after a fix to the checks - no model, no rerun. The run itself
 * is never edited: the new scores are a run of their own, in the vault's
 * evals folder as every run is, saying what it was rescored from and why.
 * A private run is never rescored.
 *
 *   npm run bots:eval:rescore -- "<run id>" --why "the number check reads 230 тысяч"
 */

const args = process.argv.slice(2)
const id = args.find((a) => !a.startsWith('--'))
const whyAt = args.indexOf('--why')
const why = whyAt >= 0 ? args[whyAt + 1] : undefined

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

function main(): void {
  if (id === undefined || why === undefined) throw new Error('Usage: npm run bots:eval:rescore -- "<run id>" --why "<what was fixed>"')
  const vault = realVault()
  const evalsDir = findEvalsFolder(vault)
  // The vault's runs and the older ones kept in the repo: either can be the one rescored.
  const runs = [...allRuns(vault), ...listRuns(REPO_STORE)].sort((x, y) => x.config.date.localeCompare(y.config.date))
  const run = runs.find((r) => r.config.run_id === id)
  if (run === undefined) throw new Error(`No run "${id}".`)
  if (run.config.vault.kind !== 'fixture') throw new Error('Only fixture runs are rescored; a private run is never touched.')
  if (run.lines.some((l) => l.contextText === undefined)) throw new Error('That run did not store its prompts: it can only be rerun.')
  const titles = titlesOf(path.join(ROOT, 'tests/bots/eval/fixture-vault'))
  const rows = run.lines.map((l) => {
    const r = fromLine(l)
    return { ...r, scores: score(r.case, r.answered, titles) }
  })
  const now = new Date()
  const newId = newRunId(vault, `${run.config.label} rescored`, now)
  const where = runPaths(vault, evalsDir, run.config.model, newId)
  const config = {
    ...run.config,
    run_id: newId,
    date: now.toISOString(),
    rescored: `${stamp(now).replace(/(\d\d)-(\d\d)$/, '$1:$2')}, from ${run.config.run_id}: ${why}`,
    note: path.relative(vault, where.note).split(path.sep).join('/'),
  }
  if (noteNames(vault).has(noteName(newId).normalize('NFC').toLowerCase()))
    throw new Error(`A note named "${noteName(newId)}" already exists in the vault; not writing over it.`)
  for (const target of [where.note, path.join(where.data, 'results.jsonl'), path.join(where.data, 'config.json')]) guard(target, vault, evalsDir, where)
  const previous = previousRun(runs.filter((r) => r.config.date < config.date), config.model, config.vault.kind)
  fs.mkdirSync(path.dirname(where.note), { recursive: true })
  fs.mkdirSync(where.data, { recursive: true })
  fs.writeFileSync(where.note, renderReport(config, rows, previous))
  fs.writeFileSync(path.join(where.data, 'results.jsonl'), `${rows.map((r) => JSON.stringify(resultLine(r))).join('\n')}\n`)
  fs.writeFileSync(path.join(where.data, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  writeVaultIndex(vault, evalsDir)
  const passed = rows.filter((r) => r.scores.pass).length
  appendEvalLog(vault, evalsDir, `- ${runLink(newId)}: ${run.config.run_id} rescored (${why}) - ${passed}/${rows.length} pass.`)
  console.log(`${passed}/${rows.length} pass after rescoring. ${os.EOL}Report: ${where.note}`)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
