import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { claimsPendingEdit, type AnswerRecord, type RecordedMessage } from '../../shared/answer-record'
import { diffLines } from '../../shared/line-diff'
import { parseNote } from '../../shared/parse'
import * as bots from '../bots'
import { openIndexForVault, send as indexer } from '../index-client'
import { readState, writeState } from '../state'
import { openVault } from '../vault'
import { writeLauncher } from '../vault-tools/launcher'
import { apply, proposal } from '../vault-tools/proposals'
import { startMcpSocket, stopMcpSocket } from '../vault-tools/socket'
import { readiness } from '.'
import { cancelQuickAsk, quickAsk } from './quick-ask'

/**
 * The evals for Quick ask (`npm run bots:eval -- --quick-ask --model claude-code`):
 * each case is a conversation about one note, put to Quick ask turn by turn
 * exactly as the bubble does - each answer's record going back with the next
 * question - with a cloud provider. A turn may first apply what the answers
 * before it suggested, as the person would. Per turn it keeps what a judge of
 * honesty needs: the answer, how many notes the folded card says it looked
 * through and which notes the activity log shows it really read, whether it
 * says an edit waits while none was made, and whether it suggests an applied
 * edit again.
 */

export type QuickAskEvalJob = {
  vault: string
  model: string
  out: string
  quickAsk: true
  cases: { id: string; note: string; turns: { question: string; applyFirst: boolean }[] }[]
}

export type QuickTurn = {
  question: string
  answer: string
  /** The earlier answers' suggestions were applied before this question. */
  appliedFirst: boolean
  /** Notes and files it read in full, by its record (what the steps card counts). */
  reads: string[]
  /** It says an edit waits for Apply, it made none, and none of the case's waits either. */
  claimsEditWithout: boolean
  proposals: number
  /** It suggests again what an applied suggestion already added. */
  reproposed: boolean
  error: string | null
  ms: number
}

const TURN_TIMEOUT_MS = 240_000

/**
 * The lines a suggestion adds, line by line against what it replaces (shared/line-diff.ts):
 * a line added again beside one like it is added too - an applied edit suggested a second
 * time is exactly that. Short lines (a blank, a "---") say nothing and are left out.
 */
const added = (id: string): Set<string> => {
  const lines = (text: string | null): string[] => (text ?? '').split('\n').map((l) => l.trim())
  return new Set(
    (proposal(id)?.files ?? []).flatMap((f) =>
      diffLines(lines(f.before), lines(f.after))
        .filter((d) => d.kind === 'added' && d.text.length > 3)
        .map((d) => d.text),
    ),
  )
}

export async function runQuickAskEval(job: QuickAskEvalJob): Promise<void> {
  // Cloud is turned on in the vault for the run: only ever a scratch copy (run.ts makes one in the temp folder).
  if (!path.resolve(job.vault).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error(`Quick ask evals run on a scratch copy in the temp folder, not ${job.vault}.`)
  const opened = openVault(job.vault)
  if (!opened.ok) throw new Error(`Could not open the eval vault: ${'error' in opened ? opened.error : 'cancelled'}`)
  await openIndexForVault()
  const access = readState(AI_ACCESS_STATE)
  writeState(AI_ACCESS_STATE, { ...coerceAiAccess(access), cloud: true })
  // The CLIs reach Recto's tools through these, as when the app runs.
  writeLauncher()
  await startMcpSocket()
  try {
    const problem = await readiness(job.model)
    if (problem !== null) throw new Error(`${job.model} cannot answer: ${problem.message}`)
    const stats = await indexer({ kind: 'stats' })
    fs.appendFileSync(
      job.out,
      `${JSON.stringify({ type: 'run', system: '', profile: null, notes: stats.kind === 'stats-result' ? stats.notes : null, cpu: os.cpus()[0]?.model ?? '', ramBytes: os.totalmem() })}\n`,
    )
    for (const item of job.cases) {
      const history: RecordedMessage[] = []
      const turns: QuickTurn[] = []
      const applied: Set<string>[] = []
      const records: AnswerRecord[] = []
      /** The case's own suggestions that wait for Apply now. */
      const waiting = (): string[] => records.flatMap((r) => r.proposals).filter((id) => proposal(id)?.status === 'pending')
      const started = performance.now()
      for (const [i, t] of item.turns.entries()) {
        // As the person would: this case's suggestions so far, applied - and counted only when they were.
        if (t.applyFirst)
          for (const id of waiting()) {
            const lines = added(id)
            if ((await apply(id)).ok) applied.push(lines)
          }
        const begun = performance.now()
        let text = ''
        let record: AnswerRecord = { read: [], skimmed: [], proposals: [] }
        let error: string | null = null
        const thread = `${item.id}-${i}`
        const timer = setTimeout(() => cancelQuickAsk(thread), TURN_TIMEOUT_MS)
        await quickAsk({ thread, note: item.note, model: job.model, history, question: t.question }, bots.localProvider(), (event) => {
          if (event.type === 'text') text += event.text
          else if (event.type === 'error') error = event.problem.message
          else if (event.type !== 'steps') {
            record = event.record
            if (event.type === 'cancelled') error = 'timeout'
          }
        })
        clearTimeout(timer)
        const again = record.proposals.some((id) => [...added(id)].some((line) => applied.some((lines) => lines.has(line))))
        // As Quick ask shows it: an edit claimed with none made, and none of the case's waiting.
        const claimsEditWithout = record.proposals.length === 0 && waiting().length === 0 && claimsPendingEdit(text)
        turns.push({
          question: t.question,
          answer: text,
          appliedFirst: t.applyFirst,
          reads: record.read,
          claimsEditWithout,
          proposals: record.proposals.length,
          reproposed: again,
          error,
          ms: performance.now() - begun,
        })
        records.push(record)
        history.push({ role: 'user', content: t.question }, { role: 'assistant', content: text, record })
      }
      // What it was given: the note, every note its answers read or skimmed, and the note's links (found or not, they were listed).
      const seen = [...new Set([item.note, ...records.flatMap((r) => [...r.read, ...r.skimmed])])]
      const text = (p: string): string => (fs.existsSync(path.join(job.vault, p)) ? fs.readFileSync(path.join(job.vault, p), 'utf8') : '')
      const links = parseNote(text(item.note)).links.map((l) => l.target)
      const given = [...new Set([...seen, ...links])]
      fs.appendFileSync(
        job.out,
        `${JSON.stringify({
          type: 'case',
          id: item.id,
          context: given.map((p) => ({ path: p, title: p.replace(/^.*\//, '').replace(/\.md$/i, ''), heading: null, score: 1 })),
          answer: turns.map((t) => t.answer).join('\n\n---\n\n'),
          // The words of what it read in full count as given; a number from a note it only skimmed is still a claim.
          contextText: [...new Set([item.note, ...records.flatMap((r) => r.read)])].map(text).join('\n\n'),
          error: turns.find((t) => t.error !== null)?.error ?? null,
          ttftMs: null,
          totalMs: performance.now() - started,
          prepareMs: 0,
          stats: null,
          turns,
        })}\n`,
      )
    }
  } finally {
    stopMcpSocket()
    // The vault's AI settings as they were.
    writeState(AI_ACCESS_STATE, coerceAiAccess(access))
  }
}
