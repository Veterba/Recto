import { isExcludedPath, type ProposalStatus } from '../../shared/ai-access'
import type { AiMessage } from '../../shared/ai'
import { withRecords, type RecordedMessage } from '../../shared/answer-record'
import type { BotSource } from '../../shared/bots'
import { SERVER_INSTRUCTIONS } from '../../shared/vault-tools'
import { runCall } from './run'
import type { ToolSession } from '../vault-tools'

/** What Recto's own providers are told, for the chat panel and for Quick ask. */

const COMMON = [
  'Answer in the language the person writes in. Be brief and concrete.',
  'Name notes as [[Note name]] links so the person can open them.',
  'You cannot change notes yourself: the propose_* tools make suggestions the person applies in Recto (Suggested edits).',
  'After proposing, say what you suggested and that it waits for Apply. Never say a note was changed.',
  'Say a suggestion waits for Apply only when a propose_* tool returned outcome "proposed" in this answer; describing an edit does not make one.',
].join(' ')

/** What keeps an answer honest about what it read, and about the answers before it. */
const RECORDS = [
  'State facts about a note only from its full text (read_note, or the note given in full). From a summary or an excerpt, say you only skimmed it, or read it in full first.',
  "After each earlier answer of yours, the next message opens with Recto's record of what that answer really read in full, only skimmed, and suggested, with each suggestion's state now. The record is what happened: never take back a read or a suggestion it shows, and do not judge an earlier answer from what is in front of you now. Recto writes the record; never write one yourself.",
  'A suggestion the record shows as applied is already in the note: do not suggest it again.',
].join(' ')

/** Why a note the tools cannot read is not a missing note. */
const LINKS_EXIST = [
  'Every link of the open note is listed with exists: true or false, and read_note gives the same for the links of a note it reads.',
  'A note with exists: true is in the vault, even when the tools cannot read it here or it was left out for room: never say it is missing, empty or not written yet.',
  'Only a link with exists: false points at a note that does not exist.',
].join(' ')

const today = (): string => new Date().toLocaleDateString('en-CA')

/** The AI guide's text, through the session (an excluded guide is not read). */
async function guide(session: ToolSession): Promise<string> {
  if (session.tools !== null && !session.tools.has('get_ai_guide')) return ''
  const text = await runCall(session, 'get_ai_guide', {})
  return text.startsWith('Error:') ? '' : `\n\nThe person's AI guide for this vault:\n${text}`
}

export async function chatSystem(session: ToolSession): Promise<string> {
  return [
    'You are Recto, the assistant inside the person’s notes app, answering in its chat panel.',
    `Today is ${today()}.`,
    SERVER_INSTRUCTIONS,
    'Look things up with the tools before answering about the vault; do not guess what a note says.',
    COMMON,
    RECORDS,
  ].join('\n\n') + (await guide(session))
}

export async function quickAskSystem(session: ToolSession, note: string): Promise<string> {
  return [
    'You are Recto, answering quick questions about the note the person has open.',
    `Today is ${today()}. The open note is “${note}”. Its text and short summaries of its linked notes are given with each question; read_note reads a linked note in full.`,
    'Answer only from that note, the notes it links to or that link to it, and the files it links or embeds (read_file reads PDFs, text files, canvases and pictures); the tools can read nothing else.',
    `Edits may only be suggested to “${note}”.`,
    LINKS_EXIST,
    COMMON,
    RECORDS,
  ].join('\n\n') + (await guide(session))
}

export async function quickAskCanvasSystem(session: ToolSession, canvas: string): Promise<string> {
  return [
    'You are Recto, answering quick questions about the canvas the person has open.',
    `Today is ${today()}. The open canvas is “${canvas}”. What is selected on it - or all of it - is given with each question: its cards, notes, files, links, groups and the arrows between them.`,
    'Answer only from that, and from the notes and files on it, which the tools can read in full (read_note for notes, read_file for PDFs, text files, canvases and pictures); they can read nothing else.',
    'Each node is named by its id (n1, n2…). To change the canvas - new cards, notes or links near a node, arrows, groups, moves - use the canvas_propose tools: your changes show on the canvas as suggestions the person accepts or rejects; say in a line what you suggested. Positions are worked out for you. Notes cannot be changed from here.',
    COMMON,
    RECORDS,
  ].join('\n\n') + (await guide(session))
}

/**
 * The conversation as a cloud provider receives it, the chats' and Quick
 * ask's alike. An earlier answer that used a note now excluded - one from
 * before the folder was excluded, or a local model's - is withheld: its text
 * may quote that note. What it used is its sources and its record. Every
 * other answer goes with its record (shared/answer-record.ts), each
 * suggestion with its state now (`status`).
 */
export function forCloud(
  turns: readonly (RecordedMessage & { sources?: BotSource[] })[],
  excluded: readonly string[],
  status: (id: string) => ProposalStatus | null,
): AiMessage[] {
  const used = (m: RecordedMessage & { sources?: BotSource[] }): string[] => [
    ...(m.sources ?? []).map((s) => s.path),
    ...(m.record?.read ?? []),
    ...(m.record?.skimmed ?? []),
  ]
  return withRecords(
    turns.map((m) =>
      m.role === 'assistant' && used(m).some((p) => isExcludedPath(p, excluded))
        ? { role: 'assistant', content: '(An earlier answer, withheld here: it used notes AI may not see.)' }
        : { role: m.role, content: m.content, ...(m.record === undefined ? {} : { record: m.record }) },
    ),
    status,
  )
}
