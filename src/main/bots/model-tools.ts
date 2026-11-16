import path from 'node:path'
import type { AiImage, AiMessage } from '../../shared/ai'
import type { Bot, BotStep } from '../../shared/bots'
import type { CatalogNote } from '../../shared/indexer-protocol'
import { imagesOf, NOT_SEEN, renderBlocks, VAULT_TOOLS } from '../../shared/vault-tools'
import * as vaultFs from '../vault-fs'
import { callTool } from '../vault-tools'
import { closeSession, openSession, type ToolSession } from '../vault-tools/sessions'
import { toolSchema } from '../providers/run'
import { cardsFor } from './cards'
import { linkStatus, linkStatusText } from './links'
import type { ToolCall } from './prepare'
import type { BotModelProvider, ChatTurn, StreamOptions, ToolSpec } from './provider'
import { closestTitles, resolveScope, type VaultNote } from './resolve'
import { cardLine, noteOutline, notesInScope, structurePatterns, vaultMap, wholeNotes, type ScopeNote } from './scope-tools'
import { groupedTasksTool, notesTool, type Embed, type ToolOptions } from './tools'

/**
 * Tools the model may call itself (3.6), in Ollama's native format: the same
 * lookups the harness makes before the answer, for when the model sees it
 * needs more. Reading a note, a file and searching are the vault tools every
 * other AI uses (vault-tools), through a session of this answer's - so the
 * same exclusions, the same exact names, the same "there is more, from
 * offset N", and what it read in the answer's steps and sources; the rest
 * are the local pipeline's own views of the vault (periods, scopes, its
 * map). A small model is held to a few calls - three, five for a review or a
 * plan - and is told when it has used them.
 */

const s = (description: string): { type: 'string'; description: string } => ({ type: 'string', description })
const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})
const DAY = 'A day, YYYY-MM-DD'
const GROUP = { type: 'string', enum: ['topic', 'note'], description: 'Group by topic (the default) or by note' }

/** The vault tools a local model gets, as every other AI has them. */
export const SHARED_TOOLS = ['search_notes', 'read_note', 'read_file'] as const

/** A vault tool's definition in Ollama's format. */
function sharedSpec(name: string): ToolSpec {
  const def = VAULT_TOOLS.find((t) => t.name === name)!
  const schema = toolSchema(def)
  return { type: 'function', function: { name, description: schema.description, parameters: schema.parameters as ToolSpec['function']['parameters'] } }
}

export const TOOL_SPECS: ToolSpec[] = [
  ...SHARED_TOOLS.map(sharedSpec),
  fn('tasks_in_period', 'Open tasks written in or carried through a period, grouped.', { from: s(DAY), to: s(DAY), group_by: GROUP }, ['from', 'to']),
  fn('notes_in_period', 'Notes written or edited in a period.', { from: s(DAY), to: s(DAY) }, ['from', 'to']),
  fn('open_tasks', 'All open tasks, any date, in a scope (a folder, project or topic), or everywhere.', {
    scope: s('Folder, project or topic; empty for all'),
    group_by: GROUP,
  }),
  fn('vault_map', 'The vault’s shape: folders with counts, stubs, orphans, naming, templates, link density.'),
  fn('read_scope', 'The notes of a folder, project or topic, as cards (or in full when few).', { scope: s('Folder, project or topic') }, ['scope']),
  fn('note_outline', 'One note’s structure: headings, section sizes, empty sections, links, properties.', { note: s('The note’s name, or its path') }, ['note']),
  fn('structure_patterns', 'Notes that share headings, how notes open, properties used together: the base for templates.'),
  fn('link_status', 'Every [[link]] in one note and whether the note it points to exists.', { note: s('The note’s name, or its path') }, ['note']),
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
  /** This answer's session for the vault tools (answerWithTools opens it); none: those tools are not offered. */
  session?: ToolSession
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A day as written, checked: a real date, or null. */
const dayOf = (v: unknown): string | null => {
  const t = str(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t
}

/** Text cut to the budget, saying so - and how to read on, when there is a way. */
const fit = (text: string, budget: number, more: string): string =>
  text.length <= budget ? text : `${text.slice(0, budget)}…\n(Cut at ${budget} of ${text.length} characters. ${more})`

/**
 * Run one tool the model asked for: the text it sees, and the notes it read (vault paths). A vault tool
 * runs in this answer's session, as any AI's call does; the local views read the catalogue.
 */
export async function runTool(name: string, args: Record<string, unknown>, c: ToolContext): Promise<{ text: string; notes: string[]; images?: AiImage[] }> {
  const read = async (notes: readonly CatalogNote[]): Promise<ScopeNote[]> => {
    const out: ScopeNote[] = []
    for (const n of notes) {
      const r = await vaultFs.readFile(n.path)
      if (r.ok) out.push({ ...n, content: r.content })
    }
    return out
  }
  /** A note by its name or path, exactly - never a neighbour's: one not found says the closest names instead. */
  const noteNamed = (given: string): CatalogNote | string => {
    const want = given.trim().replace(/\.md$/i, '').toLowerCase()
    const hits = c.catalog.filter((n) => n.path.replace(/\.md$/i, '').toLowerCase() === want || n.title.toLowerCase() === want)
    if (hits.length === 1) return hits[0]!
    if (hits.length > 1) return `${hits.length} notes are called "${given}": ${hits.map((h) => h.path).join(', ')}. Give one by its path.`
    return `No note "${given}". Closest names: ${closestTitles(given, c.vaultNotes).join(', ')}.`
  }
  if ((SHARED_TOOLS as readonly string[]).includes(name)) {
    if (c.session === undefined) return { text: `There is no tool "${name}" here.`, notes: [] }
    const before = new Set([...c.session.record.read, ...c.session.record.skimmed])
    const outcome = await callTool(name, args, c.session.client, c.session.id)
    const notes = [...c.session.record.read, ...c.session.record.skimmed].filter((p) => !before.has(p))
    if (!outcome.ok) return { text: `Error: ${outcome.error}`, notes }
    const images = imagesOf(outcome.blocks)
    return { text: renderBlocks(outcome.blocks).join('\n\n'), notes, ...(images.length > 0 ? { images } : {}) }
  }
  switch (name) {
    case 'note_outline':
    case 'link_status': {
      const found = noteNamed(str(args['note'] ?? args['title']))
      if (typeof found === 'string') return { text: found, notes: [] }
      const r = await vaultFs.readFile(found.path)
      if (!r.ok) return { text: `"${found.title}" could not be read.`, notes: [] }
      if (name === 'note_outline') return { text: noteOutline({ ...found, content: r.content }), notes: [found.path] }
      return {
        text: linkStatusText(
          found.title,
          linkStatus(
            r.content,
            found.path,
            c.vaultNotes.map((n) => n.path),
          ),
        ),
        notes: [found.path],
      }
    }
    case 'tasks_in_period':
    case 'open_tasks': {
      const scopeWords = str(args['scope'])
      const scope = scopeWords === '' ? null : resolveScope(scopeWords, c.folders, c.topics)
      const paths = scope === null || scope.kind === 'vault' ? null : new Set(notesInScope(scope, c.catalog).map((n) => n.path))
      let period: { from: string; to: string } | null = null
      if (name === 'tasks_in_period') {
        const from = dayOf(args['from'])
        const to = str(args['to']) === '' ? from : dayOf(args['to'])
        if (from === null || to === null) return { text: 'Give from and to as real days, YYYY-MM-DD.', notes: [] }
        period = from <= to ? { from, to } : { from: to, to: from }
      }
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
      return { text: fit(result.text, c.budget, 'Ask for a shorter period or a narrower scope.'), notes: result.notes.map((n) => n.path) }
    }
    case 'notes_in_period': {
      const from = dayOf(args['from'])
      const to = str(args['to']) === '' ? from : dayOf(args['to'])
      if (from === null || to === null) return { text: 'Give from and to as real days, YYYY-MM-DD.', notes: [] }
      const result = await notesTool(from <= to ? { from, to } : { from: to, to: from }, [], c.toolOptions)
      return { text: fit(result.text, c.budget, 'Ask for a shorter period.'), notes: result.notes.map((n) => n.path) }
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
      return { text: fit(text, c.budget, 'Read one of its notes with read_note for all of it.'), notes: notes.map((n) => n.path) }
    }
    default:
      return { text: `There is no tool "${name}". The tools are: ${TOOL_SPECS.map((t) => t.function.name).join(', ')}.`, notes: [] }
  }
}

/** Calls a model may make for one answer: a plain question, and a review or a plan. */
export const MAX_CALLS = 3
export const MAX_CALLS_ADVISOR = 5

/** Tool-call text the model wrote as words instead of a call: counted as a parse failure. */
const LOOKS_LIKE_A_CALL = new RegExp(`<tool_call>|"name"\\s*:\\s*"(${TOOL_SPECS.map((t) => t.function.name).join('|')})"`)

/** `read`: the vault paths the model's own calls read, in order, for the answer's sources. */
export type ToolLoopResult = { calls: ToolCall[]; parseFailures: number; read?: string[] }

/** A call as a step in the answer's steps card. */
const STEP_LABEL: Record<string, string> = {
  search_notes: 'Searching notes',
  read_note: 'Opened',
  read_file: 'Opened',
  tasks_in_period: 'Tasks in a period',
  notes_in_period: 'Notes in a period',
  open_tasks: 'Open tasks',
  vault_map: 'Looking at how the vault is organised',
  read_scope: 'Read',
  note_outline: 'Outline of',
  structure_patterns: 'Looking at how notes are built',
  link_status: 'Links in',
}
const subjectOf = (args: Record<string, unknown>): string => {
  const v = args['query'] ?? args['note'] ?? args['file'] ?? args['scope'] ?? args['title'] ?? (args['from'] === undefined ? undefined : `${str(args['from'])}…${str(args['to'])}`)
  return typeof v === 'string' && v.trim() !== '' ? `“${v.trim().replace(/\.md$/i, '').slice(0, 80)}”` : ''
}

/** What the model is told once it has used its last lookup. */
export const LAST_LOOKUP = '(That was the last lookup for this answer: answer now with what you have.)'

/**
 * The answer, with tools offered: text streams out as it comes; when the
 * model asks for tools, they run (each a step) and the model goes on with
 * what they returned. Its last allowed call says so, and after it tools are
 * no longer offered, so it answers. The vault tools run in a session of
 * this answer's, opened here and closed when it ends.
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
  const own = options.context.session === undefined && options.context.bot !== undefined
  const context: ToolContext = own
    ? {
        ...options.context,
        session: openSession({
          client: 'recto-chat · Ollama',
          tools: new Set(SHARED_TOOLS),
          notes: null,
          exclude: options.context.bot.exclude ?? [],
          writable: null,
          cloud: false,
        }),
      }
    : options.context
  try {
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
      // Past the budget no tools are offered, but a local model may ask anyway;
      // running none and asking again looped for as long as it kept asking.
      if (asked.length === 0 || used >= max) return
      turns.push({ role: 'assistant', content: wrote, tool_calls: asked.map((a) => ({ function: { name: a.name, arguments: a.args } })) })
      for (const call of asked.slice(0, max - used)) {
        used++
        const out: Awaited<ReturnType<typeof runTool>> = await runTool(call.name, call.args, context).catch((err: unknown) => ({
          text: `The tool failed: ${err instanceof Error ? err.message : String(err)}`,
          notes: [] as string[],
        }))
        for (const p of out.notes) if (!(options.result.read ??= []).includes(p)) options.result.read.push(p)
        const failed = /^(Error:|The tool failed|There is no tool|No note|Give from)/.test(out.text)
        options.onStep?.({ action: STEP_LABEL[call.name] ?? call.name, result: subjectOf(call.args) || (failed ? 'failed' : 'done'), state: failed ? 'failed' : 'done' })
        options.result.calls.push({
          name: call.name,
          args: call.args,
          by: 'model',
          summary: `${out.notes.length} notes`,
          notes: out.notes.map((p) => path.basename(p, '.md')),
          result: out.text,
        })
        const sees = out.images !== undefined && (await provider.canSee?.(options.model)) === true
        const said = out.images !== undefined && !sees ? `${out.text}\n\n${NOT_SEEN}` : out.text
        turns.push({ role: 'tool', content: used >= max ? `${said}\n\n${LAST_LOOKUP}` : said, tool_name: call.name })
        if (sees && out.images !== undefined) turns.push({ role: 'user', content: `The pictures ${call.name} returned:`, images: out.images })
      }
    }
  } finally {
    if (own && context.session !== undefined) closeSession(context.session.id)
  }
}
