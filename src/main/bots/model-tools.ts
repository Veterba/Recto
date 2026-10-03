import path from 'node:path'
import type { AiMessage } from '../../shared/ai'
import type { Bot, BotStep } from '../../shared/bots'
import type { CatalogNote } from '../../shared/indexer-protocol'
import * as vaultFs from '../vault-fs'
import { cardsFor } from './cards'
import { chunkNote } from './chunks'
import type { ToolCall } from './prepare'
import type { BotModelProvider, ChatTurn, StreamOptions, ToolSpec } from './provider'
import { closestTitles, findNote, resolveScope, type VaultNote } from './resolve'
import { cardLine, noteOutline, notesInScope, structurePatterns, vaultMap, wholeNotes, type ScopeNote } from './scope-tools'
import { groupedTasksTool, notesTool, type Embed, type ToolOptions } from './tools'
import { searchVectors } from './vectors'

/**
 * Tools the model may call itself (3.6), in Ollama's native format: the same
 * lookups the harness makes before the answer, for when the model sees it
 * needs more. A small model is held to a few calls - three, five for a review
 * or a plan - and then it answers with what it has.
 */

const s = (description: string): { type: 'string'; description: string } => ({ type: 'string', description })
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

export const TOOL_SPECS: ToolSpec[] = [
  fn(
    'search_notes',
    'Search the notes by words and meaning; returns the best matching passages.',
    { query: s('What to look for, in any language') },
    ['query'],
  ),
  fn('read_note', 'Read one note by its title.', { title: s('The note title') }, ['title']),
  fn(
    'tasks_in_period',
    'Open tasks written in or carried through a period, grouped.',
    { from: s('YYYY-MM-DD'), to: s('YYYY-MM-DD'), group_by: s('topic or note') },
    ['from', 'to'],
  ),
  fn('notes_in_period', 'Notes written or edited in a period.', { from: s('YYYY-MM-DD'), to: s('YYYY-MM-DD') }, ['from', 'to']),
  fn('open_tasks', 'All open tasks, any date, in a scope (a folder, project or topic), or everywhere.', {
    scope: s('Folder, project or topic; empty for all'),
    group_by: s('topic or note'),
  }),
  fn('vault_map', 'The vault’s shape: folders with counts, stubs, orphans, naming, templates, link density.'),
  fn(
    'read_scope',
    'The notes of a folder, project or topic, as cards (or in full when few).',
    { scope: s('Folder, project or topic'), focus: s('What to look at') },
    ['scope'],
  ),
  fn('note_outline', 'One note’s structure: headings, section sizes, empty sections, links, properties.', { title: s('The note title') }, [
    'title',
  ]),
  fn('structure_patterns', 'Notes that share headings, how notes open, properties used together: the base for templates.'),
]

export type ToolContext = {
  bot: Bot
  catalog: readonly CatalogNote[]
  vaultNotes: readonly VaultNote[]
  folders: readonly string[]
  topics: readonly string[]
  toolOptions: ToolOptions
  embed: Embed
  model: string
  budget: number
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Run one tool the model asked for: the text it sees, and the notes it read. */
export async function runTool(name: string, args: Record<string, unknown>, c: ToolContext): Promise<{ text: string; notes: string[] }> {
  const read = async (notes: readonly CatalogNote[]): Promise<ScopeNote[]> => {
    const out: ScopeNote[] = []
    for (const n of notes) {
      const r = await vaultFs.readFile(n.path)
      if (r.ok) out.push({ ...n, content: r.content })
    }
    return out
  }
  const noteByTitle = (title: string): CatalogNote | null => {
    const found = findNote(title, c.vaultNotes)
    return found === null ? null : (c.catalog.find((n) => n.path === found.path) ?? null)
  }
  switch (name) {
    case 'search_notes': {
      const hits = await searchVectors(str(args['query']), 4, c.bot.exclude ?? [])
      return {
        text:
          hits.length === 0
            ? 'Nothing found.'
            : hits.map((h) => `### ${path.basename(h.path, '.md')}${h.heading === '' ? '' : ` › ${h.heading}`}\n${h.text}`).join('\n\n'),
        notes: [...new Set(hits.map((h) => path.basename(h.path, '.md')))],
      }
    }
    case 'read_note':
    case 'note_outline': {
      const title = str(args['title'])
      const note = noteByTitle(title)
      if (note === null) return { text: `No note "${title}". Closest titles: ${closestTitles(title, c.vaultNotes).join(', ')}.`, notes: [] }
      const [full] = await read([note])
      if (full === undefined) return { text: `"${title}" could not be read.`, notes: [] }
      if (name === 'note_outline') return { text: noteOutline(full), notes: [full.title] }
      const pieces = chunkNote(full.title, full.content)
      const text = pieces.map((p) => p.text).join('\n\n')
      return { text: `### ${full.title}\n${text.length > c.budget ? `${text.slice(0, c.budget)}…` : text}`, notes: [full.title] }
    }
    case 'tasks_in_period':
    case 'open_tasks': {
      const scopeWords = str(args['scope'])
      const scope = scopeWords === '' ? null : resolveScope(scopeWords, c.folders, c.topics)
      const paths = scope === null || scope.kind === 'vault' ? null : new Set(notesInScope(scope, c.catalog).map((n) => n.path))
      const period =
        name === 'tasks_in_period' && str(args['from']) !== ''
          ? { from: str(args['from']), to: str(args['to']) || str(args['from']) }
          : null
      const result = await groupedTasksTool(
        {
          period,
          scope:
            paths === null
              ? null
              : {
                  label: scopeWords,
                  paths,
                  describe: `${scopeWords}: ${[...paths].map((p) => path.basename(p, '.md')).join(', ')}`,
                },
          groupBy: str(args['group_by']) === 'note' ? 'note' : 'topic',
        },
        c.catalog,
        c.embed,
        c.toolOptions,
      )
      return { text: result.text, notes: result.notes.map((n) => n.title) }
    }
    case 'notes_in_period': {
      const result = await notesTool({ from: str(args['from']), to: str(args['to']) || str(args['from']) }, [], c.toolOptions)
      return { text: result.text, notes: result.notes.map((n) => n.title) }
    }
    case 'vault_map': {
      const all = await read(c.catalog)
      return { text: vaultMap(all, await cardsFor(c.model, c.catalog)), notes: [] }
    }
    case 'structure_patterns':
      return { text: structurePatterns(await read(c.catalog)), notes: [] }
    case 'read_scope': {
      const scope = resolveScope(str(args['scope']), c.folders, c.topics)
      if (scope === null) return { text: `No folder, project or topic called "${str(args['scope'])}".`, notes: [] }
      const notes = await read(notesInScope(scope, c.catalog))
      const whole = wholeNotes(notes, c.budget)
      const cards = await cardsFor(c.model, notes)
      const text = whole ?? notes.map((n) => cardLine(n, cards.get(n.path))).join('\n')
      return { text: text.length > c.budget ? `${text.slice(0, c.budget)}…` : text, notes: notes.map((n) => n.title) }
    }
    default:
      return { text: `There is no tool "${name}".`, notes: [] }
  }
}

/** Calls a model may make for one answer: a plain question, and a review or a plan. */
export const MAX_CALLS = 3
export const MAX_CALLS_ADVISOR = 5

/** Tool-call text the model wrote as words instead of a call: counted as a parse failure. */
const LOOKS_LIKE_A_CALL =
  /<tool_call>|"name"\s*:\s*"(search_notes|read_note|tasks_in_period|notes_in_period|open_tasks|vault_map|read_scope|note_outline|structure_patterns)"/

export type ToolLoopResult = { calls: ToolCall[]; parseFailures: number }

/**
 * The answer, with tools offered: text streams out as it comes; when the
 * model asks for tools, they run (each a step) and the model goes on with
 * what they returned. After the last allowed call, tools are no longer
 * offered, so it has to answer.
 */
export async function* answerWithTools(
  provider: BotModelProvider,
  history: readonly AiMessage[],
  system: string,
  options: StreamOptions & { advisor: boolean; context: ToolContext; onStep?: (step: BotStep) => void; result: ToolLoopResult },
): AsyncIterable<string> {
  if (provider.streamChat === undefined) {
    yield* provider.stream([...history], system, options)
    return
  }
  const turns: ChatTurn[] = [...history]
  const max = options.advisor ? MAX_CALLS_ADVISOR : MAX_CALLS
  let used = 0
  for (;;) {
    const offer = used < max ? TOOL_SPECS : []
    let wrote = ''
    let asked: { name: string; args: Record<string, unknown> }[] = []
    for await (const event of provider.streamChat(turns, system, offer, options)) {
      if (event.type === 'text') {
        wrote += event.text
        yield event.text
      } else asked = event.calls
    }
    if (LOOKS_LIKE_A_CALL.test(wrote)) options.result.parseFailures++
    if (asked.length === 0) return
    turns.push({ role: 'assistant', content: wrote, tool_calls: asked.map((a) => ({ function: { name: a.name, arguments: a.args } })) })
    for (const call of asked.slice(0, max - used)) {
      used++
      const out = await runTool(call.name, call.args, options.context).catch((err: unknown) => ({
        text: `The tool failed: ${err instanceof Error ? err.message : String(err)}`,
        notes: [] as string[],
      }))
      options.onStep?.({ action: call.name, result: out.notes[0] ?? '', state: 'done' })
      options.result.calls.push({
        name: call.name,
        args: call.args,
        by: 'model',
        summary: `${out.notes.length} notes`,
        notes: out.notes,
        result: out.text,
      })
      turns.push({ role: 'tool', content: out.text, tool_name: call.name })
    }
  }
}
