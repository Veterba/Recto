import fs from 'node:fs'
import path from 'node:path'
import { KINDS } from './cases.ts'
import { summarise, type Scored } from './metrics.ts'
import { fromLine, gb, pct, secs } from './report.ts'
import { REAL_VAULT, findEvalsFolder, gradesOf, guard, listRuns, modelSlug, runPaths, stamp, type StoredRun } from './store.ts'

/**
 * npm run bots:eval:compare -- "<run id A>" "<run id B>" [more…]
 *
 * Runs side by side - two runs of one model, or the same cases on several
 * models - written as a note of its own ("Eval <time> — comparison …") beside
 * the newest run's.
 */

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const vaultFlag = process.argv.indexOf('--evals-vault')
const evalsVault = vaultFlag >= 0 ? process.argv[vaultFlag + 1]! : REAL_VAULT
const evalsDir = findEvalsFolder(evalsVault)

function main(): void {
  if (ids.length < 2) throw new Error('Give at least two run ids: npm run bots:eval:compare -- "<run id A>" "<run id B>"')
  const all = listRuns(evalsVault)
  const runs: StoredRun[] = ids.map((id) => {
    const found = all.filter((r) => r.config.run_id === id)
    if (found.length !== 1)
      throw new Error(found.length === 0 ? `No run "${id}".` : `More than one run "${id}": ${found.map((r) => r.note).join(', ')}`)
    return found[0]!
  })
  const rows = runs.map((r) => r.lines.map(fromLine) as Scored[])
  const names = runs.map((r) => `${r.config.model} · ${r.config.label}`)
  const newest = [...runs].sort((a, b) => a.config.date.localeCompare(b.config.date)).at(-1)!

  const out: string[] = []
  out.push(`# Recto Eval comparison: ${names.join(' vs ')}`)
  out.push('')
  out.push(`Runs: ${runs.map((r) => `"${r.config.run_id}" (${r.config.model}, ${r.config.git.commit.slice(0, 7)})`).join(', ')}.`)
  const sameCases = new Set(runs.map((r) => r.config.cases_sha)).size === 1
  out.push(sameCases ? 'All on the same cases.' : '**The runs used different cases**: per-kind numbers are not strictly comparable.')
  out.push('')

  out.push('## Quality per kind (pass · recall@4)')
  out.push('')
  out.push(`| Kind | ${names.join(' | ')} |`)
  out.push(`|---|${names.map(() => '---').join('|')}|`)
  const kinds = KINDS.filter((k) => rows.some((rs) => rs.some((r) => r.case.kind === k)))
  for (const k of [...kinds, null]) {
    const cells = rows.map((rs) => {
      const s = summarise(k === null ? rs : rs.filter((r) => r.case.kind === k))
      return s.cases === 0 ? '—' : `${s.passed}/${s.cases} · ${pct(s.recall4)}`
    })
    out.push(`| ${k ?? '**overall**'} | ${cells.join(' | ')} |`)
  }
  out.push('')

  out.push('## Speed, memory, grades')
  out.push('')
  out.push(`| | ${names.join(' | ')} |`)
  out.push(`|---|${names.map(() => '---').join('|')}|`)
  const metric = (label: string, f: (r: StoredRun, s: ReturnType<typeof summarise>) => string): void => {
    out.push(`| ${label} | ${runs.map((r, i) => f(r, summarise(rows[i]!))).join(' | ')} |`)
  }
  metric('TTFT p50 / p90', (_, s) => `${secs(s.ttftP50)} / ${secs(s.ttftP90)}`)
  metric('Total p50 / p90', (_, s) => `${secs(s.totalP50)} / ${secs(s.totalP90)}`)
  metric('Tokens/s', (_, s) => (s.tokensPerSec === null ? '—' : s.tokensPerSec.toFixed(1)))
  // Ollama's own count; gemma4's engine maps its weights without counting them, so it reads far too low there.
  metric("Model size by Ollama's count (low for gemma4)", (r) => gb(r.config.memory.modelBytes))
  metric('Peak resident: Ollama / app', (r) => `${gb(r.config.memory.ollamaPeakBytes)} / ${gb(r.config.memory.appPeakBytes)}`)
  metric('Swap used before → after', (r) => `${gb(r.config.memory.swapBeforeBytes)} → ${gb(r.config.memory.swapAfterBytes)}`)
  metric('macOS started swapping more', (r) =>
    r.config.memory.swapBeforeBytes === null || r.config.memory.swapAfterBytes === null
      ? '—'
      : r.config.memory.swapAfterBytes - r.config.memory.swapBeforeBytes > 100e6
        ? `yes (+${gb(r.config.memory.swapAfterBytes - r.config.memory.swapBeforeBytes)})`
        : 'no',
  )
  metric('Tool call / JSON parse failures', (r) =>
    r.config.harness.router || r.config.harness.tools
      ? String(r.lines.filter((l) => (l.router as { parseFailed?: boolean } | null)?.parseFailed === true).length)
      : '— (no router or tools yet)',
  )
  metric('My grades (good of graded)', (r) => {
    const g = [...gradesOf(r).values()]
    return g.length === 0 ? '—' : `${g.filter((x) => x.grade === 'good').length} of ${g.length}`
  })
  out.push('')

  out.push('## Per case')
  out.push('')
  out.push(`| Case | Kind | ${names.join(' | ')} |`)
  out.push(`|---|---|${names.map(() => '---').join('|')}|`)
  const caseIds = [...new Set(rows.flatMap((rs) => rs.map((r) => r.case.id)))]
  for (const id of caseIds) {
    const kind = rows.flatMap((rs) => rs.filter((r) => r.case.id === id))[0]?.case.kind ?? ''
    const cells = rows.map((rs) => {
      const r = rs.find((x) => x.case.id === id)
      return r === undefined
        ? '—'
        : `${r.scores.pass ? 'PASS' : 'FAIL'}${r.scores.reasons.length === 0 ? '' : ` (${r.scores.reasons.join(', ')})`}`
    })
    out.push(`| \`${id}\` | ${kind} | ${cells.join(' | ')} |`)
  }
  out.push('')

  const id = `${stamp(new Date())} — comparison ${runs.map((r) => modelSlug(r.config.model)).join(' vs ')}`.replace(/[\\/:*?"<>|]/g, '-')
  const where = runPaths(evalsVault, evalsDir, newest.config.model, id)
  guard(where.note, evalsVault, evalsDir, where)
  if (fs.existsSync(where.note)) throw new Error(`${where.note} exists already.`)
  const target = where.note
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${out.join('\n')}\n`)
  console.log(`Comparison: ${target}`)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
