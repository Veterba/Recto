import { isExcludedPath } from '../../shared/ai-access'
import type { AiMessage } from '../../shared/ai'
import type { BotMessage } from '../../shared/bots'
import { SERVER_INSTRUCTIONS } from '../../shared/vault-tools'
import { runCall } from './run'
import type { ToolSession } from '../vault-tools'

/** What Recto's own providers are told, for the chat panel and for Quick ask. */

const COMMON = [
  'Answer in the language the person writes in. Be brief and concrete.',
  'Name notes as [[Note name]] links so the person can open them.',
  'You cannot change notes yourself: the propose_* tools make suggestions the person applies in Recto (Suggested edits).',
  'After proposing, say what you suggested and that it waits for Apply. Never say a note was changed.',
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
  ].join('\n\n') + (await guide(session))
}

export async function quickAskSystem(session: ToolSession, note: string): Promise<string> {
  return [
    'You are Recto, answering quick questions about the note the person has open.',
    `Today is ${today()}. The open note is “${note}”. Its text and its linked notes are given with each question.`,
    'Answer only from that note, the notes it links to or that link to it, and the files it links or embeds (read_file reads PDFs, text files, canvases and pictures); the tools can read nothing else.',
    `Edits may only be suggested to “${note}”.`,
    COMMON,
  ].join('\n\n') + (await guide(session))
}

export async function quickAskCanvasSystem(session: ToolSession, canvas: string): Promise<string> {
  return [
    'You are Recto, answering quick questions about the canvas the person has open.',
    `Today is ${today()}. The open canvas is “${canvas}”. What is selected on it - or all of it - is given with each question: its cards, notes, files, links, groups and the arrows between them.`,
    'Answer only from that, and from the notes and files on it, which the tools can read in full (read_note for notes, read_file for PDFs, text files, canvases and pictures); they can read nothing else.',
    'Each node is named by its id (n1, n2…). To change the canvas - new cards, notes or links near a node, arrows, groups, moves - use the canvas_propose tools: your changes show on the canvas as suggestions the person accepts or rejects; say in a line what you suggested. Positions are worked out for you. Notes cannot be changed from here.',
    COMMON,
  ].join('\n\n') + (await guide(session))
}

/**
 * The conversation as a cloud provider receives it. An earlier answer that
 * read a note now excluded - a local model's, or one from before the folder
 * was excluded - is withheld: its text may quote that note.
 */
export function forCloud(turns: BotMessage[], excluded: readonly string[]): AiMessage[] {
  return turns.map((m) =>
    m.role === 'assistant' && (m.sources ?? []).some((s) => isExcludedPath(s.path, excluded))
      ? { role: 'assistant', content: '(An earlier answer, withheld here: it used notes AI may not see.)' }
      : { role: m.role, content: m.content },
  )
}
