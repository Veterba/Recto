import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AI_ACCESS_STATE, coerceAiAccess } from '../../shared/ai-access'
import { claimsPendingEdit, type AnswerRecord, type RecordedMessage } from '../../shared/answer-record'
import { stepsSummary } from '../../shared/bot-status'
import { parseNote } from '../../shared/parse'
import type { BotStep } from '../../shared/bots'
import { VAULT_STATE_DIR } from '../../shared/vault'
import * as bots from '../bots'
import { openIndexForVault, send as indexer } from '../index-client'
import { readState, writeState } from '../state'
import { openVault } from '../vault'
import { writeLauncher } from '../vault-tools/launcher'
import { apply, listProposals, proposal } from '../vault-tools/proposals'
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
  /** "Looked through N notes": N; null when the card says something else. */
  shown: number | null
  /** Notes and files the activity log shows it read in full (read_note, read_file). */
  reads: string[]
  /** It says an edit waits for Apply, and it made none. */
  claimsEditWithout: boolean
  proposals: number
  /** It suggests again what an applied suggestion already added. */
  reproposed: boolean
  error: string | null
  ms: number
}

const TURN_TIMEOUT_MS = 240_000

/** The lines a suggestion adds. */
const added = (id: string): Set<string> => {
  const files = proposal(id)?.files ?? []
  const lines = (text: string | null): string[] =>
    (text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 3)
  return new Set(files.flatMap((f) => lines(f.after).filter((l) => !new Set(lines(f.before)).has(l))))
}

/** Read calls in the activity log since `since`: the notes and files it really read, each once. */
function readsSince(vault: string, since: number): string[] {
  const file = path.join(vault, VAULT_STATE_DIR, 'ai-activity.jsonl')
  if (!fs.existsSync(file)) return []
  const names = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { at: number; tool: string; args: string; outcome: string })
    .filter((e) => e.at >= since && e.outcome === 'ok' && (e.tool === 'read_note' || e.tool === 'read_file'))
    .map((e) => /(?:note|file): ([^,]+)/.exec(e.args)?.[1]?.trim() ?? e.args)
  return [...new Set(names)]
}

export async function runQuickAskEval(job: QuickAskEvalJob): Promise<void> {
  const opened = openVault(job.vault)
  if (!opened.ok) throw new Error(`Could not open the eval vault: ${'error' in opened ? opened.error : 'cancelled'}`)
  await openIndexForVault()
  // The vault is a scratch copy: cloud providers are what this run is for.
  writeState(AI_ACCESS_STATE, { ...coerceAiAccess(readState(AI_ACCESS_STATE)), cloud: true })
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
      const started = performance.now()
      for (const [i, t] of item.turns.entries()) {
        if (t.applyFirst)
          for (const p of listProposals().filter((x) => x.status === 'pending')) {
            applied.push(added(p.id))
            await apply(p.id)
          }
        const at = Date.now()
        const begun = performance.now()
        let text = ''
        let steps: BotStep[] = []
        let record: AnswerRecord = { read: [], skimmed: [], proposals: [] }
        let error: string | null = null
        const thread = `${item.id}-${i}`
        const timer = setTimeout(() => cancelQuickAsk(thread), TURN_TIMEOUT_MS)
        await quickAsk({ thread, note: item.note, model: job.model, history, question: t.question }, bots.localProvider(), (event) => {
          if (event.type === 'text') text += event.text
          else if (event.type === 'steps') steps = event.steps
          else if (event.type === 'error') error = event.problem.message
          else {
            record = event.record
            if (event.type === 'cancelled') error = 'timeout'
          }
        })
        clearTimeout(timer)
        const shown = /^Looked through (\d+)/.exec(stepsSummary(steps, record.skimmed.length))?.[1]
        const again = record.proposals.some((id) => [...added(id)].some((line) => applied.some((lines) => lines.has(line))))
        turns.push({
          question: t.question,
          answer: text,
          appliedFirst: t.applyFirst,
          shown: shown === undefined ? null : Number(shown),
          reads: readsSince(job.vault, at),
          claimsEditWithout: record.proposals.length === 0 && claimsPendingEdit(text),
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
  }
}
