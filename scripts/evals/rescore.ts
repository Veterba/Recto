import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { score } from './metrics.ts'
import { fromLine, renderReport, resultLine } from './report.ts'
import { REPO_STORE, ROOT, allRuns, dataDirOf, previousRun, stamp, writeVaultIndex } from './store.ts'

/**
 * Score a fixture run again from what it stored (answers, contexts, the
 * prompts), after a fix to the checks - no model, no rerun. Only runs in the
 * repo (docs/evals): a private run in the vault is never edited.
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
  const runs = allRuns()
  const run = runs.find((r) => r.config.run_id === id)
  if (run === undefined) throw new Error(`No run "${id}".`)
  if (!run.data.startsWith(dataDirOf(REPO_STORE)))
    throw new Error('Only fixture runs in the repo are rescored; a run in the vault is never edited.')
  if (run.lines.some((l) => l.contextText === undefined)) throw new Error('That run did not store its prompts: it can only be rerun.')
  const titles = titlesOf(path.join(ROOT, 'tests/bots/eval/fixture-vault'))
  const rows = run.lines.map((l) => {
    const r = fromLine(l)
    return { ...r, scores: score(r.case, r.answered, titles) }
  })
  const config = { ...run.config, rescored: `${stamp(new Date()).replace(/(\d\d)-(\d\d)$/, '$1:$2')}: ${why}` }
  const before = runs.filter((r) => r.config.date < run.config.date)
  const previous = previousRun(before, config.model, config.vault.kind)
  fs.writeFileSync(run.note, renderReport(config, rows, previous))
  fs.writeFileSync(path.join(run.data, 'results.jsonl'), `${rows.map((r) => JSON.stringify(resultLine(r))).join('\n')}\n`)
  fs.writeFileSync(path.join(run.data, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  writeVaultIndex(REPO_STORE, REPO_STORE)
  const passed = rows.filter((r) => r.scores.pass).length
  console.log(`${passed}/${rows.length} pass after rescoring. ${os.EOL}Report: ${run.note}`)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
