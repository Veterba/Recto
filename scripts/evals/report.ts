import { KINDS, type Case, type Kind } from './cases.ts'
import { REASONS, notesRead, percentile, summarise, type Answered, type Reason, type Scored, type Scores, type Summary } from './metrics.ts'

/**
 * "Recto Eval Report v1": one run as report.md (for reading, and for grading
 * by ticking boxes), results.jsonl and config.json (for machines). The
 * headings never change; a new report version bumps REPORT_VERSION and keeps
 * reading the older ones.
 */

export const REPORT_VERSION = 1

export type Harness = { router: boolean; hybridRetrieval: boolean; namedNotes: boolean; tools: boolean; stickyContext: boolean }

export type Memory = {
  /** Peak resident memory of Ollama's processes, and of the app's, sampled every second. */
  ollamaPeakBytes: number | null
  appPeakBytes: number | null
  /** What Ollama says the model takes in memory (/api/ps). */
  modelBytes: number | null
  swapBeforeBytes: number | null
  swapAfterBytes: number | null
}

export type RunConfig = {
  report_version: number
  run_id: string
  label: string
  date: string
  model: string
  profile: unknown
  harness: Harness
  git: { commit: string; branch: string; dirty: boolean }
  app_version: string
  system: string
  system_sha: string
  cases_file: string
  cases_sha: string
  today: string | null
  vault: { kind: 'fixture' | 'copy'; notes: number | null; languages: Record<string, number> }
  machine: { chip: string; ram_bytes: number }
  ollama: { version: string | null; speed_check_tokens_per_sec?: number | null; one_model_loaded: string }
  memory: Memory
  /** Why it was run, for the eval log. */
  why: string | null
}

export type Grade = { grade: 'good' | 'bad'; note: string; question: string }

/** One line of results.jsonl. */
export type ResultLine = {
  id: string
  kind: Kind
  question: string
  messages: Case['messages']
  expectNotes: string[]
  expectAnswer: string | null
  expectNoSources: boolean
  router: unknown
  steps: unknown
  toolCalls: unknown
  context: Answered['context']
  answer: string
  error: string | null
  timings: {
    ttftMs: number | null
    totalMs: number
    prepareMs: number
    tokensPerSec: number | null
    promptTokens: number | null
    evalTokens: number | null
  }
  scores: Scores
}

export function resultLine(row: Scored): ResultLine {
  const { case: c, answered: a, scores } = row
  return {
    id: c.id,
    kind: c.kind,
    question: c.question,
    messages: c.messages,
    expectNotes: c.expectNotes,
    expectAnswer: c.expectAnswer,
    expectNoSources: c.expectNoSources,
    router: a.router ?? null,
    steps: a.steps ?? null,
    toolCalls: a.toolCalls ?? null,
    context: a.context,
    answer: a.answer,
    error: a.error,
    timings: {
      ttftMs: a.ttftMs,
      totalMs: a.totalMs,
      prepareMs: a.prepareMs,
      tokensPerSec: a.stats !== null && a.stats.evalMs > 0 ? a.stats.evalTokens / (a.stats.evalMs / 1000) : null,
      promptTokens: a.stats?.promptTokens ?? null,
      evalTokens: a.stats?.evalTokens ?? null,
    },
    scores,
  }
}

/** A result line back as a scored row, so older runs are summed up the same way. */
export function fromLine(line: ResultLine): Scored {
  return {
    case: {
      id: line.id,
      kind: line.kind,
      messages: line.messages,
      question: line.question,
      expectNotes: line.expectNotes,
      expectAnswer: line.expectAnswer,
      expectNoSources: line.expectNoSources,
    },
    answered: {
      id: line.id,
      context: line.context,
      answer: line.answer,
      error: line.error,
      ttftMs: line.timings.ttftMs,
      totalMs: line.timings.totalMs,
      prepareMs: line.timings.prepareMs,
      stats:
        line.timings.evalTokens !== null && line.timings.tokensPerSec !== null && line.timings.tokensPerSec > 0
          ? {
              promptTokens: line.timings.promptTokens ?? 0,
              promptMs: 0,
              evalTokens: line.timings.evalTokens,
              evalMs: (line.timings.evalTokens / line.timings.tokensPerSec) * 1000,
              loadMs: 0,
            }
          : null,
    },
    scores: line.scores,
  }
}

/**
 * Grades ticked in a report.md: per case id, good or bad and the note. A case
 * with neither box ticked is not graded.
 */
export function readGrades(reportMd: string): Map<string, Grade> {
  const grades = new Map<string, Grade>()
  const appendix = reportMd.split(/^## Appendix: cases\s*$/m)[1] ?? ''
  for (const section of appendix.split(/^### /m).slice(1)) {
    const id = section.split('·')[0]?.trim() ?? ''
    const good = /^- \[[xX]\] good\s*$/m.test(section)
    const bad = /^- \[[xX]\] bad\s*$/m.test(section)
    if (id === '' || good === bad) continue
    const note = /^- Note:[ \t]*(.*)$/m.exec(section)?.[1]?.trim() ?? ''
    const question = /^\*\*Question:\*\*[ \t]*(.*)$/m.exec(section)?.[1]?.trim() ?? ''
    grades.set(id, { grade: good ? 'good' : 'bad', note, question })
  }
  return grades
}

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`)
const num = (v: number | null, digits = 2): string => (v === null ? '—' : v.toFixed(digits))
const secs = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const gb = (bytes: number | null): string => (bytes === null ? '—' : `${(bytes / 1e9).toFixed(1)} GB`)
const one = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** ▲ / ▼ and the change, for a metric where more is better (or less, for times). */
function delta(now: number | null, before: number | null, kind: 'share' | 'ms' | 'num'): string {
  if (now === null || before === null) return ''
  const d = now - before
  if (Math.abs(d) < (kind === 'ms' ? 50 : 0.005)) return ' (=)'
  const better = kind === 'ms' ? d < 0 : d > 0
  const arrow = better ? '▲' : '▼'
  const amount =
    kind === 'share'
      ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} pt`
      : kind === 'ms'
        ? `${d > 0 ? '+' : ''}${(d / 1000).toFixed(1)} s`
        : `${d > 0 ? '+' : ''}${d.toFixed(2)}`
  return ` ${arrow} ${amount}`
}

const kindsIn = (rows: readonly Scored[]): Kind[] => KINDS.filter((k) => rows.some((r) => r.case.kind === k))

function resultsTable(rows: readonly Scored[], before: readonly Scored[] | null): string[] {
  const lines = ['| Kind | Cases | Pass | recall@4 | Named in answer | Sources correct | Honest |', '|---|---|---|---|---|---|---|']
  const row = (label: string, now: Summary, was: Summary | null): string =>
    `| ${label} | ${now.cases} | ${now.passed}/${now.cases} (${pct(now.passRate)})${was === null ? '' : delta(now.passRate, was.passRate, 'share')} | ${pct(now.recall4)}${was === null ? '' : delta(now.recall4, was.recall4, 'share')} | ${pct(now.namedInAnswer)}${was === null ? '' : delta(now.namedInAnswer, was.namedInAnswer, 'share')} | ${pct(now.sourcesCorrect)}${was === null ? '' : delta(now.sourcesCorrect, was.sourcesCorrect, 'share')} | ${pct(now.honest)}${was === null ? '' : delta(now.honest, was.honest, 'share')} |`
  for (const kind of kindsIn(rows)) {
    const now = summarise(rows.filter((r) => r.case.kind === kind))
    const prev = before?.filter((r) => r.case.kind === kind) ?? []
    lines.push(row(kind, now, before === null || prev.length === 0 ? null : summarise(prev)))
  }
  lines.push(row('**overall**', summarise(rows), before === null ? null : summarise(before)))
  return lines
}

function latencyTable(rows: readonly Scored[]): string[] {
  const lines = ['| Kind | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s |', '|---|---|---|---|---|---|']
  const line = (label: string, s: Summary): string =>
    `| ${label} | ${secs(s.ttftP50)} | ${secs(s.ttftP90)} | ${secs(s.totalP50)} | ${secs(s.totalP90)} | ${num(s.tokensPerSec, 1)} |`
  for (const kind of kindsIn(rows)) lines.push(line(kind, summarise(rows.filter((r) => r.case.kind === kind))))
  lines.push(line('**overall**', summarise(rows)))
  return lines
}

/** How bad a failure is, for picking the five worst: retrieval and honesty first, then time. */
function severity(r: Scored): number {
  if (r.scores.pass) return -1
  const weights: Partial<Record<Reason, number>> = {
    error: 6,
    hallucination: 5,
    'ignored named note': 5,
    'wrong note': 4,
    'retrieval miss': 4,
    'unneeded retrieval': 3,
    language: 2,
    'too slow': 1,
  }
  return r.scores.reasons.reduce((s, reason) => s + (weights[reason] ?? 0), 0) + (1 - (r.scores.recall4 ?? 1)) + r.answered.totalMs / 1e6
}

export function worst(rows: readonly Scored[], n = 5): Scored[] {
  return [...rows]
    .filter((r) => !r.scores.pass)
    .sort((a, b) => severity(b) - severity(a))
    .slice(0, n)
}

function why(r: Scored): string {
  const parts: string[] = []
  const read = notesRead(r.answered.context)
  for (const reason of r.scores.reasons) {
    if (reason === 'retrieval miss' || reason === 'wrong note' || reason === 'ignored named note')
      parts.push(
        `${reason}: expected ${r.case.expectNotes.join(', ')}; read ${read.length === 0 ? 'nothing' : read.slice(0, 4).join(', ')}`,
      )
    else if (reason === 'unneeded retrieval') parts.push(`unneeded retrieval: read ${read.slice(0, 4).join(', ')}`)
    else if (reason === 'hallucination') parts.push('hallucination: answered as if the notes had it')
    else if (reason === 'language') parts.push('language: answered in another language than the question')
    else if (reason === 'too slow') parts.push(`too slow: ${secs(r.answered.totalMs)}`)
    else parts.push(`error: ${r.answered.error ?? ''}`)
  }
  return parts.join('; ')
}

export type Previous = { config: RunConfig; rows: Scored[]; grades: Map<string, Grade> }

function summaryText(config: RunConfig, rows: readonly Scored[], previous: Previous | null): string {
  const s = summarise(rows)
  const head = `${s.passed} of ${s.cases} cases pass (${pct(s.passRate)}), recall@4 ${pct(s.recall4)}, time to first token ${secs(s.ttftP50)} at the median (p90 ${secs(s.ttftP90)}), ${num(s.tokensPerSec, 1)} tokens/s.`
  if (previous === null)
    return `First run of this kind: ${config.model} on the ${config.vault.kind === 'fixture' ? 'fixture vault' : 'vault copy'}, labelled "${config.label}". ${head} Nothing to compare with yet, so this is the baseline later runs are measured against.`
  const was = summarise(previous.rows)
  const changes: string[] = []
  const p = previous.config
  if (p.model !== config.model) changes.push(`the model (${p.model} → ${config.model})`)
  if (p.git.commit !== config.git.commit)
    changes.push(
      `the code (${p.git.commit.slice(0, 7)} → ${config.git.commit.slice(0, 7)}${config.git.dirty ? ', uncommitted changes' : ''})`,
    )
  if (p.system_sha !== config.system_sha) changes.push('SYSTEM.md')
  if (p.cases_sha !== config.cases_sha) changes.push('the cases')
  for (const [key, on] of Object.entries(config.harness))
    if ((p.harness as Record<string, boolean>)[key] !== on) changes.push(`${key} ${on ? 'on' : 'off'}`)
  const byKind = kindsIn(rows).map((k) => {
    const now = summarise(rows.filter((r) => r.case.kind === k)).passRate
    const prev = previous.rows.filter((r) => r.case.kind === k)
    return { k, d: prev.length === 0 ? 0 : now - summarise(prev).passRate }
  })
  const win = [...byKind].sort((a, b) => b.d - a.d)[0]
  const loss = [...byKind].sort((a, b) => a.d - b.d)[0]
  return [
    `Compared to "${p.run_id}", what changed: ${changes.length === 0 ? 'nothing in the setup (same model, code, prompt and cases) - differences are the model’s own variation' : changes.join(', ')}.`,
    head,
    `Pass rate ${pct(was.passRate)} → ${pct(s.passRate)}, recall@4 ${pct(was.recall4)} → ${pct(s.recall4)}, TTFT p50 ${secs(was.ttftP50)} → ${secs(s.ttftP50)}.`,
    win !== undefined && win.d > 0 ? `Biggest win: ${win.k} (${delta(win.d, 0, 'share').trim()}).` : 'No kind got better.',
    loss !== undefined && loss.d < 0 ? `Biggest regression: ${loss.k} (${delta(loss.d, 0, 'share').trim()}).` : 'No kind got worse.',
  ].join(' ')
}

const onOff = (v: boolean): string => (v ? 'on' : 'off')

export function renderReport(config: RunConfig, rows: readonly Scored[], previous: Previous | null): string {
  const s = summarise(rows)
  const out: string[] = []
  out.push('---')
  out.push(`run_id: "${config.run_id}"`)
  out.push(`date: ${config.date}`)
  out.push(`model: ${config.model}`)
  out.push(`commit: ${config.git.commit.slice(0, 7)}${config.git.dirty ? ' (dirty)' : ''}`)
  out.push(`report_version: ${config.report_version}`)
  out.push(`compared_to: ${previous === null ? 'none' : `"${previous.config.run_id}"`}`)
  out.push('---')
  out.push('')
  out.push(`# Recto Eval: ${config.label}`)
  out.push('')
  out.push('## Summary')
  out.push('')
  out.push(summaryText(config, rows, previous))
  out.push('')

  out.push('## Setup')
  out.push('')
  out.push(`- Model: ${config.model}, via Ollama ${config.ollama.version ?? '?'}; one model loaded: ${config.ollama.one_model_loaded}`)
  if (config.ollama.speed_check_tokens_per_sec != null)
    out.push(
      `- Speed check before the run: ${config.ollama.speed_check_tokens_per_sec.toFixed(1)} tokens/s (a throttling Mac shows under 5)`,
    )
  out.push(`- Profile: \`${JSON.stringify(config.profile)}\``)
  out.push(
    `- Harness: router ${onOff(config.harness.router)}, hybrid retrieval ${onOff(config.harness.hybridRetrieval)}, named notes ${onOff(config.harness.namedNotes)}, tools ${onOff(config.harness.tools)}, sticky context ${onOff(config.harness.stickyContext)}`,
  )
  out.push(`- SYSTEM.md: sha256 \`${config.system_sha.slice(0, 12)}\` (full text in config.json)`)
  out.push(
    `- Vault: ${config.vault.kind === 'fixture' ? 'fixture vault' : 'copy of the real vault'}, ${config.vault.notes ?? '?'} notes (${Object.entries(
      config.vault.languages,
    )
      .map(([l, n]) => `${l} ${n}`)
      .join(', ')}); today = ${config.today ?? 'the run date'}`,
  )
  out.push(`- Cases: ${config.cases_file} (sha256 \`${config.cases_sha.slice(0, 12)}\`)`)
  out.push(`- Machine: ${config.machine.chip}, ${Math.round(config.machine.ram_bytes / 2 ** 30)} GB RAM`)
  out.push(
    `- Code: ${config.git.branch} @ ${config.git.commit.slice(0, 7)}${config.git.dirty ? ' with uncommitted changes' : ''}, app ${config.app_version}`,
  )
  out.push('')

  out.push('## Dataset')
  out.push('')
  const langs = new Map<string, number>()
  for (const r of rows) {
    const l = /\p{Script=Cyrillic}/u.test(r.case.question) ? 'ru' : /[æøå]|\b(hvilke|jeg|har)\b/i.test(r.case.question) ? 'no' : 'en'
    langs.set(l, (langs.get(l) ?? 0) + 1)
  }
  out.push(
    `${rows.length} cases; questions in ${[...langs].map(([l, n]) => `${l} ${n}`).join(', ')}; ${rows.filter((r) => r.case.expectAnswer !== null).length} with an expected answer, ${rows.filter((r) => r.case.messages.length > 0).length} with earlier turns.`,
  )
  out.push('')
  out.push('| Kind | Cases |')
  out.push('|---|---|')
  for (const k of kindsIn(rows)) out.push(`| ${k} | ${rows.filter((r) => r.case.kind === k).length} |`)
  out.push('')

  out.push('## Metrics')
  out.push('')
  out.push(
    `- **recall@4**: ${pct(s.recall4)}. For cases with expected notes, the share of them among the first four distinct notes the bot read, averaged over cases.`,
  )
  out.push(`- **note-named-in-answer**: ${pct(s.namedInAnswer)}. The answer names at least one expected note by title.`)
  out.push(
    `- **sources-correct**: ${pct(s.sourcesCorrect)}. Small-talk, self and no-sources cases read no notes; cases with expected notes read at least one of them.`,
  )
  out.push(`- **not-in-vault honesty**: ${pct(s.honest)}. Not-in-vault answers say the notes don't have it (pattern match, EN/RU/NO).`)
  const graded = previous === null ? [] : [...previous.grades.values()]
  out.push(
    `- **my grade**: ${graded.length === 0 ? '— (nothing graded yet)' : `${pct(graded.filter((g) => g.grade === 'good').length / graded.length)} good of ${graded.length} graded`} — boxes ticked in the compared run's report (this run's are graded after it is read).`,
  )
  out.push(`- **TTFT** p50 ${secs(s.ttftP50)}, p90 ${secs(s.ttftP90)} — from the question to the first token, including the vault search.`)
  out.push(`- **total time** p50 ${secs(s.totalP50)}, p90 ${secs(s.totalP90)} — from the question to the last token.`)
  out.push(`- **tokens/sec**: ${num(s.tokensPerSec, 1)}. Answer tokens over generation time, as Ollama reports them, averaged over cases.`)
  out.push(
    `- **peak memory**: Ollama ${gb(config.memory.ollamaPeakBytes)} resident, the model ${gb(config.memory.modelBytes)} by Ollama's own count (far too low for gemma4, whose engine maps its weights without counting them), the app ${gb(config.memory.appPeakBytes)}; swap used ${gb(config.memory.swapBeforeBytes)} before → ${gb(config.memory.swapAfterBytes)} after.`,
  )
  out.push(
    "- **PASS** — no failure reason: expected notes at recall@4 ≥ 0.5, no notes read when none should be, honest when the vault has nothing, answered in the question's language, no error. Too slow (> 60 s) is reported, not failed.",
  )
  out.push('')

  out.push('## Results')
  out.push('')
  out.push(...resultsTable(rows, null))
  out.push('')

  out.push(`## Compared to ${previous === null ? 'nothing (first run)' : previous.config.run_id}`)
  out.push('')
  if (previous === null) out.push('No earlier run to compare with.')
  else {
    out.push(...resultsTable(rows, previous.rows))
    out.push('')
    const before = new Map(previous.rows.map((r) => [r.case.id, r]))
    const flips = (from: boolean, to: boolean): string[] =>
      rows
        .filter((r) => before.has(r.case.id) && before.get(r.case.id)!.scores.pass === from && r.scores.pass === to)
        .map((r) => `\`${r.case.id}\``)
    const lost = flips(true, false)
    const gained = flips(false, true)
    out.push(`- pass → fail: ${lost.length === 0 ? 'none' : lost.join(', ')}`)
    out.push(`- fail → pass: ${gained.length === 0 ? 'none' : gained.join(', ')}`)
    const graded = rows.flatMap((r) => {
      const g = previous.grades.get(r.case.id)
      const was = before.get(r.case.id)
      if (g === undefined || was === undefined || g.question !== r.case.question) return []
      const changed = one(was.answered.answer) !== one(r.answered.answer)
      return [
        `\`${r.case.id}\`: was graded ${g.grade}${g.note === '' ? '' : ` ("${g.note}")`}, answer ${changed ? 'changed' : 'unchanged'}`,
      ]
    })
    out.push(`- grades from the compared run: ${graded.length === 0 ? 'none' : ''}`)
    for (const g of graded) out.push(`  - ${g}`)
  }
  out.push('')

  out.push('## Latency')
  out.push('')
  out.push(...latencyTable(rows))
  out.push('')

  out.push('## Error analysis')
  out.push('')
  const bad = worst(rows)
  if (bad.length === 0) out.push('No case failed.')
  for (const r of bad) out.push(`- \`${r.case.id}\` (${r.case.kind}) — ${why(r)}`)
  out.push('')
  const counted = REASONS.map((reason) => [reason, rows.filter((r) => r.scores.reasons.includes(reason)).length] as const).filter(
    ([, n]) => n > 0,
  )
  if (counted.length > 0) {
    out.push('Failures (and slow answers) per reason, across all cases:')
    out.push('')
    out.push('| Reason | Cases |')
    out.push('|---|---|')
    for (const [reason, n] of counted) out.push(`| ${reason} | ${n} |`)
    out.push('')
  }

  out.push('## Appendix: cases')
  out.push('')
  for (const r of rows) {
    const { case: c, answered: a } = r
    out.push(`### ${c.id} · ${c.kind} · ${r.scores.pass ? 'PASS' : 'FAIL'}`)
    out.push('')
    for (const t of c.messages) out.push(`> ${t.role === 'user' ? 'You' : 'Recto'}: ${one(t.content)}`)
    if (c.messages.length > 0) out.push('')
    out.push(`**Question:** ${one(c.question)}`)
    out.push('')
    out.push(`**Router:** ${a.router == null ? '—' : `\`${JSON.stringify(a.router)}\``}`)
    out.push('')
    out.push(`**Steps:** ${a.steps == null ? '—' : `\`${JSON.stringify(a.steps)}\``}`)
    out.push('')
    out.push(`**Tool calls:** ${a.toolCalls == null ? '—' : `\`${JSON.stringify(a.toolCalls)}\``}`)
    out.push('')
    out.push('**Notes in context:**')
    if (a.context.length === 0) out.push('- none')
    for (const n of a.context)
      out.push(`- ${n.title}${n.heading === null ? '' : ` › ${n.heading}`} (\`${n.path}\`, score ${n.score.toFixed(2)})`)
    out.push('')
    out.push('**Answer:**')
    out.push('')
    out.push(
      a.error !== null
        ? `_Error: ${a.error}_`
        : a.answer.trim() === ''
          ? '_(empty)_'
          : a.answer
              .trim()
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n'),
    )
    out.push('')
    out.push(
      `**Expected:** notes ${c.expectNotes.length === 0 ? '—' : c.expectNotes.join(', ')}${c.expectNoSources ? ' (no sources)' : ''}; answer ${c.expectAnswer ?? '—'}`,
    )
    out.push('')
    out.push(
      `**Scores:** recall@4 ${pct(r.scores.recall4)}, named in answer ${r.scores.namedInAnswer ?? '—'}, sources correct ${r.scores.sourcesCorrect ?? '—'}, honest ${r.scores.honest ?? '—'}, language ${r.scores.languageOk ? 'ok' : 'wrong'}${r.scores.reasons.length === 0 ? '' : ` — ${r.scores.reasons.join(', ')}`}`,
    )
    out.push('')
    const tps = a.stats !== null && a.stats.evalMs > 0 ? a.stats.evalTokens / (a.stats.evalMs / 1000) : null
    out.push(`**Timings:** TTFT ${secs(a.ttftMs)}, total ${secs(a.totalMs)}, search ${secs(a.prepareMs)}, ${num(tps, 1)} tokens/s`)
    out.push('')
    out.push('**Grade**')
    out.push('- [ ] good')
    out.push('- [ ] bad')
    out.push('- Note: ')
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/** For the index tables: the numbers a run is listed with. */
export function headline(rows: readonly Scored[]): { recall4: number | null; ttftP50: number | null; passRate: number } {
  const s = summarise(rows)
  return { recall4: s.recall4, ttftP50: s.ttftP50, passRate: s.passRate }
}

export { percentile, pct, secs, gb }
