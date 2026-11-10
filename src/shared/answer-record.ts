import type { AiMessage } from './ai'
import type { ProposalStatus } from './ai-access'

/**
 * What an answer really did, taken from its tool calls: the notes whose full
 * text it read, the ones it only saw a summary, snippet or excerpt of, and the
 * suggestions it made. Kept with the answer, and given back to the model with
 * every later question - the model never sees its earlier tool results, and
 * without this it would judge its own earlier answer from the summaries in
 * front of it now, and take back reads and edits that did happen.
 *
 * Paths and ids only, never note text.
 */
export type AnswerRecord = { read: string[]; skimmed: string[]; proposals: string[] }

/** A message as kept by Quick ask and the chats: the record goes with an answer. */
export type RecordedMessage = AiMessage & { record?: AnswerRecord }

/**
 * An answer's sources: the notes it read in full - or, when it opened none, the ones it
 * skimmed, which are then all it went on. A search hit it never opened is not a source.
 */
export const sourcesOf = (record: AnswerRecord): string[] => (record.read.length > 0 ? record.read : record.skimmed)

const title = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')

const STATE: Record<ProposalStatus | 'expired', string> = {
  pending: 'waiting for Apply',
  applied: 'applied, already in the note - do not suggest it again',
  discarded: 'discarded by the person',
  stale: 'out of date: the note changed since, so it can no longer be applied',
  expired: 'expired',
}

/** The record as one line for the model, each suggestion with its state now (`status`: null when it is gone). */
export function recordLine(record: AnswerRecord, status: (id: string) => ProposalStatus | null): string {
  const names = (paths: string[]): string => (paths.length === 0 ? 'none' : paths.map(title).join(', '))
  const counts = new Map<string, number>()
  for (const id of record.proposals) {
    const state = STATE[status(id) ?? 'expired']
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const suggested = record.proposals.length === 0 ? 'none' : [...counts].map(([state, n]) => `${n} ${state}`).join('; ')
  return `(Recto's record of your answer above - what really happened: read in full: ${names(record.read)}; only skimmed (summary or excerpt): ${names(record.skimmed)}; suggested edits: ${suggested}.)`
}

/**
 * The conversation as a model gets it, the new question last: the record of
 * each earlier answer opens the message after it - Recto's words, not the
 * answer's, so the model does not take it for a way to end its own.
 */
export const withRecords = (messages: readonly RecordedMessage[], status: (id: string) => ProposalStatus | null): AiMessage[] =>
  messages.map(({ role, content }, i) => {
    const before = messages[i - 1]
    return role === 'user' && before?.role === 'assistant' && before.record !== undefined
      ? { role, content: `${recordLine(before.record, status)}\n\n${content}` }
      : { role, content }
  })

const CLAIM_EN =
  /\b(?:wait(?:s|ing)? for (?:your )?apply|(?:click|press|tap) apply|review the suggested edit|in suggested edits|i(?:'ve|’ve| have)? (?:proposed|suggested) (?:an? |the |some |these |those )?(?:edits?|changes?|addition))\b/i
const CLAIM_RU = /(?<!\p{L})(?:ждёт|ждет|ожида\p{L}*)\s+(?:твоего\s+|вашего\s+)?(?:apply|применени\p{L}*)/iu
/** "Nothing is waiting for Apply", «ничего не ждёт»: a clause that denies it. */
const DENIES = /\b(?:no|not|nothing|none|never|isn['’]t|aren['’]t|couldn['’]t|can['’]t|didn['’]t|wasn['’]t)\b|(?<!\p{L})(?:не|ничего|нет)(?!\p{L})/iu
/** Where one clause ends and the next begins: punctuation, and "and", "but", «и», «но», «а». */
const CLAUSE = /[,;:—–()]|\s(?:and|but|while|и|но|а)\s/iu

/**
 * Does the answer say an edit is waiting for Apply? Then one must exist: an
 * answer that only writes about a suggestion has made none. Each clause is
 * read on its own: "Nothing waits for Apply" claims nothing, while "it is not
 * applied yet and waits for Apply" does - the "not" is another clause's.
 */
export const claimsPendingEdit = (text: string): boolean =>
  text
    .split(/(?<=[.!?…])\s+|\n+/)
    .flatMap((sentence) => sentence.split(CLAUSE))
    .some((clause) => (CLAIM_EN.test(clause) || CLAIM_RU.test(clause)) && !DENIES.test(clause))
