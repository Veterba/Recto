import path from 'node:path'
import type { AiMessage } from '../../shared/ai'
import { BOTS_FOLDER, CHATS_FOLDER, type Bot, type BotHarness, type BotSource, type BotStep } from '../../shared/bots'
import type { CatalogNote } from '../../shared/indexer-protocol'
import { send as indexer } from '../index-client'
import * as vaultFs from '../vault-fs'
import { cardsFor, type NoteCard } from './cards'
import { chunkNote } from './chunks'
import { byKind, classify, exampleTexts } from './classify'
import { buildSystem, estimateTokens, fitHistory, isExcluded, rankNotes, type Chunk } from './context'
import { CONTEXT_TOKENS, type BotModelProvider } from './provider'
import { resolveNames, resolveScope, type Named, type NotFound, type Scope, type VaultNote } from './resolve'
import { fuse, pick, RRF_K, type Candidate } from './retrieve'
import { route, routedTerms, type Classifier, type Route, type RouteKind } from './router'
import { isoDate, type Period } from './period'
import { cardLine, noteOutline, notesInScope, structurePatterns, vaultMap, wholeNotes, type ScopeNote } from './scope-tools'
import { groupedTasksTool, notesTool, tasksTool, type ToolOptions } from './tools'
import { intentOf } from './task-answer'
import { embedTexts, searchVectors } from './vectors'
import type { ToolContext } from './model-tools'

/**
 * Everything the model is given for one answer, worked out before it writes
 * a word: what kind of question this is (router), which notes and scopes it
 * names (resolve), what the harness looks up for that kind (tasks, the notes
 * of a period, a scope's notes, the vault's map), and the best pieces of the
 * notes by words and meaning (retrieve). Each step is reported as it happens
 * ("Searching notes → “Recto plan”"), for the steps card and the evals.
 *
 * The chat and the evals both go through this, so an eval measures what the
 * chat does.
 */

/** A note the bot read for an answer, as the evals report it: which part, and how well its note ranked. */
export type ContextNote = { path: string; title: string; heading: string | null; score: number }

/** A tool call made for an answer - by the harness itself, or asked for by the model. */
export type ToolCall = {
  name: string
  args: Record<string, unknown>
  by: 'harness' | 'model'
  summary: string
  notes: string[]
  /** What it returned, as the model saw it (kept in eval results, not in reports). */
  result: string
}

export type Prepared = {
  system: string
  history: AiMessage[]
  chunks: Chunk[] | null
  /** Everything the answer was given to read, for the evals. */
  context: ContextNote[]
  route: Route | null
  toolCalls: ToolCall[]
  /** The notes to show under the answer. */
  sources: ContextNote[]
  /** Text the harness wrote itself, shown first; the model's reply follows it. */
  preface: string | null
  steps: BotStep[]
  /** The longest answer for this kind of question. */
  maxTokens: number
  /** A review or a plan: more tool calls allowed. */
  advisor: boolean
  /** What the model's own tool calls run against; null when it may not call any (small talk, a task list). */
  toolContext: ToolContext | null
}

export type PrepareOptions = {
  harness: BotHarness
  provider: BotModelProvider
  model: string
  today?: Date
  /** The status line: "Reading 12 notes… 7/12". */
  onProgress?: (text: string) => void
  /** Every change to the steps, the whole list each time. */
  onSteps?: (steps: BotStep[]) => void
  /** The sources of the last answers in this topic, newest last (sticky context). */
  sticky?: readonly BotSource[]
}

/** Room left in the context window for the answer itself. */
const ANSWER_TOKENS = 1024
/** The notes' share of the prompt, in characters: a plain answer, and a review or plan. */
const CONTEXT_CHARS = 6000
const ADVISOR_CHARS = 11_000
/** A named note this small goes in whole; a bigger one gives its best pieces. */
const WHOLE_NOTE_TOKENS = 1500
/** Answers to reviews and plans may run this long; others keep the profile's length. */
const ADVISOR_MAX_TOKENS = 1200
const DEFAULT_MAX_TOKENS = 600
/** A scope bigger than this is read card by card, in batches, by the model (map-reduce). */
const MAP_REDUCE_NOTES = 12
const BATCH = 10
/** Index notes link out to this many notes or more, with few words around each link. */
const HUB_LINKS = 8
const HUB_BYTES_PER_LINK = 150
/** For a review or a plan, a related note must be this close in meaning (the noise floor is about 0.4). */
const ADVISOR_MIN_VECTOR = 0.55

const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const lastUser = (messages: readonly AiMessage[]): string => [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
const isRu = (text: string): boolean => /[а-яё]/i.test(text)

/** The router's example questions, embedded once per run of the app. */
let examples: Promise<Record<RouteKind, number[][]> | null> | null = null
export const embeddingClassifier: Classifier = async (question) => {
  examples ??= embedTexts(exampleTexts(), 'classify').then((v) => (v === null ? null : byKind(v)))
  const ex = await examples
  if (ex === null) {
    examples = null
    return null
  }
  const v = (await embedTexts([question], 'classify'))?.[0]
  return v === undefined ? null : classify(v, ex)
}

const embedClassify = (texts: string[]): Promise<number[][] | null> => embedTexts(texts, 'classify')

/** Aliases as the index keeps them ("[a, b]", "a, b", one name). */
const aliasesOf = (raw: string | null): string[] =>
  raw === null
    ? []
    : raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((a) => a.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)

const topicsOf = (notes: readonly CatalogNote[]): string[] => {
  const out = new Set<string>()
  for (const n of notes) for (const m of (n.topics ?? '').matchAll(/topics\/([^\]"]+)/g)) out.add(m[1]!.trim())
  return [...out]
}

const foldersOf = (notes: readonly CatalogNote[]): string[] => {
  const out = new Set<string>()
  for (const n of notes) {
    const parts = n.path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out]
}

async function readNotes(notes: readonly CatalogNote[]): Promise<ScopeNote[]> {
  const out: ScopeNote[] = []
  for (const n of notes) {
    const read = await vaultFs.readFile(n.path)
    if (read.ok) out.push({ ...n, content: read.content })
  }
  return out
}

/** "Learning/Math Khan Academy" → "Math Khan Academy"; the vault → "the vault" / «хранилище». */
const scopeName = (scope: Scope, ru: boolean): string =>
  scope.kind === 'vault'
    ? ru
      ? 'хранилище'
      : 'the vault'
    : scope.kind === 'folder'
      ? scope.folder.slice(scope.folder.lastIndexOf('/') + 1)
      : scope.topic

export async function prepare(bot: Bot, messages: readonly AiMessage[], o: PrepareOptions): Promise<Prepared> {
  const { harness, provider, model } = o
  const today = o.today ?? new Date()
  const question = lastUser(messages)
  const ru = isRu(question)
  const steps: BotStep[] = []
  const step = (action: string, result = '', state: BotStep['state'] = 'running'): number => {
    steps.push({ action, result, state })
    o.onSteps?.(steps.map((s) => ({ ...s })))
    return steps.length - 1
  }
  const finish = (i: number, result: string, state: BotStep['state'] = 'done'): void => {
    steps[i] = { ...steps[i]!, result, state }
    o.onSteps?.(steps.map((s) => ({ ...s })))
  }
  const toolCalls: ToolCall[] = []
  const exclude = [CHATS_FOLDER, path.dirname(BOTS_FOLDER), ...(bot.exclude ?? [])]

  const routed = harness.router ? await route(provider, model, messages, today, harness.classifier ? embeddingClassifier : null) : null
  const kind: RouteKind = routed?.kind ?? 'notes'
  const advisor = harness.scopeTools && (kind === 'review' || kind === 'advice')
  const maxTokens = advisor ? ADVISOR_MAX_TOKENS : DEFAULT_MAX_TOKENS
  const finishWith = (
    system: string,
    context: ContextNote[],
    extra: Partial<Pick<Prepared, 'chunks' | 'preface' | 'sources' | 'toolContext'>> = {},
  ): Prepared => {
    const history = fitHistory(messages, CONTEXT_TOKENS - Math.max(ANSWER_TOKENS, maxTokens) - estimateTokens(system))
    return {
      system,
      history,
      chunks: extra.chunks ?? null,
      context,
      route: routed,
      toolCalls,
      sources: extra.sources ?? context,
      preface: extra.preface ?? null,
      steps,
      maxTokens,
      advisor,
      toolContext: extra.toolContext ?? null,
    }
  }

  // Small talk and questions about Recto itself ask nothing of the vault: no search, no sources, no steps.
  if (kind === 'smalltalk' || kind === 'self') return finishWith(bot.system.trim(), [])

  const toolOptions: ToolOptions = {
    bot,
    question,
    provider,
    model,
    today: isoDate(today),
    looseTasks: harness.looseTasks,
    ...(o.onProgress === undefined ? {} : { onProgress: o.onProgress }),
  }

  const catalogResponse = harness.namedNotes || harness.scopeTools ? await indexer({ kind: 'bot-catalog' }, 30_000).catch(() => null) : null
  const catalog = (catalogResponse?.kind === 'bot-catalog-result' ? catalogResponse.notes : []).filter((n) => !isExcluded(n.path, exclude))
  const vaultNotes: VaultNote[] = catalog.map((n) => ({ path: n.path, title: n.title, aliases: aliasesOf(n.aliases) }))
  const names = harness.namedNotes ? resolveNames(question, vaultNotes) : { named: [] as Named[], notFound: [] as NotFound[] }
  const found0 = harness.namedNotes ? resolveScope(routed?.scope ?? question, foldersOf(catalog), topicsOf(catalog)) : null
  // A question about one named note is about that note, not the folder it happens to sit in.
  const scope = found0?.kind === 'folder' && names.named.some((n) => n.path.startsWith(`${found0.folder}/`)) ? null : found0

  // ---- tasks and "what did I do" ------------------------------------------------------
  if (routed !== null && harness.taskIndex && (kind === 'tasks' || kind === 'recent')) {
    const period: Period | null = routed.period
    const fallback = { from: isoDate(addDays(today, kind === 'tasks' ? -13 : -6)), to: isoDate(today) }
    const scoped = scope !== null && scope.kind !== 'vault' ? scope : null
    const i = step(kind === 'tasks' ? (ru ? 'Задачи' : 'Tasks') : ru ? 'Заметки за период' : 'Notes of the period')
    o.onProgress?.(
      kind === 'tasks'
        ? ru
          ? 'Смотрю задачи…'
          : 'Checking your tasks…'
        : ru
          ? 'Листаю заметки за период…'
          : 'Going through the notes of the period…',
    )
    let result
    let name: string
    let args: Record<string, unknown>
    // The whole open list, grouped - unless the question also asks what got done: that answer has its own shape.
    const asksDone = /\b(done|finish(ed)?|complete(d)?)\b|сделан|выполн|закрыл|законч|ferdig/i.test(question)
    if (kind === 'tasks' && harness.scopeTools && intentOf(question) === 'open' && !asksDone && (scoped !== null || period !== null)) {
      const paths = scoped === null ? null : new Set(notesInScope(scoped, catalog).map((n) => n.path))
      const taskScope =
        scoped === null || paths === null
          ? null
          : {
              label: scopeName(scoped, ru),
              paths,
              describe: `${scopeName(scoped, false)}: ${[...paths]
                .map((p) => path.basename(p, '.md'))
                .slice(0, 15)
                .join(', ')}`,
            }
      name = taskScope !== null && period === null ? 'open_tasks' : 'tasks_in_period'
      args =
        taskScope !== null
          ? { scope: taskScope.label, group_by: 'note' }
          : { from: period!.from, to: period!.to, status: 'open', group_by: 'topic' }
      result = await groupedTasksTool(
        { period, scope: taskScope, groupBy: taskScope !== null ? 'note' : 'topic' },
        catalog,
        embedClassify,
        toolOptions,
      )
    } else {
      const p = period ?? fallback
      name = kind === 'tasks' ? 'tasks_in_period' : 'notes_in_period'
      args = { from: p.from, to: p.to }
      result =
        kind === 'tasks'
          ? await tasksTool(p, 'all', routedTerms(question, routed), toolOptions)
          : await notesTool(p, [...routed.keywordsEn, ...routed.keywordsRu], toolOptions)
    }
    toolCalls.push({ name, args, by: 'harness', summary: result.summary, notes: result.notes.map((n) => n.title), result: result.text })
    finish(i, result.summary)
    if (result.answer !== undefined) {
      // A task list a small model would drop items from: the harness shows it as it is, and the
      // model only adds one line of its own after it.
      const system = `${bot.system.trim()}\n\n## What the user was just shown, in answer to their message\n\n${result.answer}\n\nWrite ONE short sentence to follow it, in the language of the user's message - a remark or an offer. Don't repeat or change the list.`
      return finishWith(system, result.notes, { preface: result.answer })
    }
    return finishWith(`${bot.system.trim()}\n\n${result.text}`, result.notes)
  }

  // ---- notes, reviews, advice ------------------------------------------------------------
  const budget = advisor ? ADVISOR_CHARS : CONTEXT_CHARS
  let used = 0
  const sections: string[] = []
  const context: ContextNote[] = []
  const pieces: Chunk[] = []
  const add = (text: string, notes: ContextNote[]): void => {
    sections.push(text)
    used += text.length
    for (const n of notes) context.push(n)
  }

  // Named notes: whole when small, else their best pieces. Never another note in their place.
  for (const n of names.named) {
    const i = step(ru ? 'Открыл' : 'Opened', n.title)
    const read = await vaultFs.readFile(n.path)
    if (!read.ok) {
      finish(i, n.title, 'failed')
      continue
    }
    const chunks = chunkNote(n.title, read.content)
    let chosen = chunks
    if (estimateTokens(read.content) > WHOLE_NOTE_TOKENS) {
      const hits = await searchVectors(question, 3, [], [n.path])
      const keys = new Set(hits.map((h) => h.idx))
      chosen = keys.size > 0 ? chunks.filter((c) => keys.has(c.idx)) : chunks.slice(0, 3)
      if (!chosen.some((c) => c.idx === 0) && chunks[0] !== undefined) chosen = [chunks[0], ...chosen].slice(0, 4)
    }
    for (const c of chosen) {
      const heading = c.path.length === 0 ? null : c.path.join(' > ')
      pieces.push({ path: n.path, title: n.title, heading, text: c.text, idx: c.idx })
      used += c.text.length
    }
    finish(i, n.title)
  }
  for (const nf of names.notFound) {
    const i = step(ru ? 'Не нашёл' : "Couldn't open", `${nf.asked} · ${ru ? 'ближе всего' : 'closest'}: ${nf.closest.join(', ')}`)
    finish(i, steps[i]!.result, 'failed')
    add(
      `## A note the user named that doesn't exist\n"${nf.asked}" matches no note in the vault. The closest titles: ${nf.closest.map((t) => `"${t}"`).join(', ')}. Say so plainly and offer these; don't answer from another note as if it were "${nf.asked}".`,
      [],
    )
  }

  // The scope tools, for reviews and advice.
  if (advisor) {
    const wantsTemplates = /templat|шаблон|mal(er)?\b/i.test(question)
    const wantsStructure = /structur|структур|outline|organi[sz]|организ/i.test(question)
    const cards: Map<string, NoteCard> =
      harness.noteCards && scope !== null
        ? await cardsFor(model, scope.kind === 'vault' ? catalog : notesInScope(scope, catalog))
        : new Map()
    if (scope?.kind === 'vault' || wantsTemplates) {
      const i = step(ru ? 'Карта хранилища' : 'Mapping the vault')
      const all = await readNotes(catalog)
      const map = vaultMap(all, harness.noteCards && scope?.kind === 'vault' ? cards : new Map())
      toolCalls.push({ name: 'vault_map', args: {}, by: 'harness', summary: `${all.length} notes`, notes: [], result: map })
      add(map, [])
      if (wantsTemplates) {
        const patterns = structurePatterns(all)
        toolCalls.push({ name: 'structure_patterns', args: {}, by: 'harness', summary: 'patterns', notes: [], result: patterns })
        add(patterns, [])
      }
      // Its sources: the notes the map and the patterns single out (quoted, or given as an example), and the templates.
      const shown = sections.join('\n')
      const singled = all
        .filter((n) => shown.includes(`"${n.title}"`) || shown.includes(`e.g. ${n.title}`) || /^templates?\//i.test(n.path))
        .slice(0, 8)
      for (const [k, n] of singled.entries())
        context.push({ path: n.path, title: n.title, heading: null, score: Math.max(0.1, 2 - k * 0.1) })
      finish(i, `${all.length} ${ru ? 'заметок' : 'notes'}`)
    } else if (scope !== null) {
      const label = scopeName(scope, ru)
      const inScope = await readNotes(notesInScope(scope, catalog))
      const i = step(ru ? `Читаю ${label}` : `Reading ${label}`, `0/${inScope.length}`)
      const whole = wholeNotes(inScope, budget - used - 1500)
      let text: string
      if (whole !== null) text = `## The notes in ${label} (${inScope.length}), in full\n\n${whole}`
      else if (inScope.length <= MAP_REDUCE_NOTES) {
        // Cards, and each note's outline: what is in it and how it is built.
        text = [
          `## The notes in ${label} (${inScope.length}): cards and outlines`,
          ...inScope.map((n) => `${cardLine(n, cards.get(n.path))}\n${noteOutline(n).split('\n').slice(2).join('\n')}`),
        ].join('\n\n')
      } else {
        const findings: string[] = []
        for (let b = 0; b < inScope.length; b += BATCH) {
          const batch = inScope.slice(b, b + BATCH)
          finish(i, `${Math.min(b + BATCH, inScope.length)}/${inScope.length}`, 'running')
          o.onProgress?.(`${ru ? 'Читаю' : 'Reading'} ${label}… ${Math.min(b + BATCH, inScope.length)}/${inScope.length}`)
          const raw = await provider
            .complete(
              [
                {
                  role: 'user',
                  content: `Question: ${question}\n\nNotes:\n${batch.map((n) => cardLine(n, cards.get(n.path))).join('\n')}`,
                },
              ],
              'You read note cards for a question about these notes. Write 2-4 short findings that matter for the question, each naming its note in quotes. Facts from the cards only. Plain lines, no intro.',
              { model, signal: AbortSignal.timeout(60_000), maxTokens: 220 },
            )
            .catch(() => '')
          if (raw.trim() !== '') findings.push(raw.trim())
        }
        text = `## What the notes in ${label} (${inScope.length}) hold, read card by card\n\n${findings.join('\n')}\n\nAll notes: ${inScope.map((n) => n.title).join(', ')}`
      }
      if (text.length > budget - used) text = `${text.slice(0, Math.max(0, budget - used - 1)).trimEnd()}…`
      const notes = inScope.map((n, k) => ({ path: n.path, title: n.title, heading: null, score: Math.max(0.1, 3 - k * 0.1) }))
      toolCalls.push({
        name: 'read_scope',
        args: { scope: label },
        by: 'harness',
        summary: `${inScope.length} notes`,
        notes: notes.map((n) => n.title),
        result: text,
      })
      add(text, notes)
      finish(i, `${inScope.length}/${inScope.length}`)
    }
    if (wantsStructure && names.named.length > 0) {
      for (const n of names.named) {
        const c = catalog.find((x) => x.path === n.path)
        const read = c === undefined ? null : await readNotes([c])
        if (read === null || read[0] === undefined) continue
        const outline = noteOutline(read[0])
        toolCalls.push({
          name: 'note_outline',
          args: { title: n.title },
          by: 'harness',
          summary: n.title,
          notes: [n.title],
          result: outline,
        })
        add(outline, [])
      }
    }
  }

  // Search: words and meaning, fused - for every question, with what room is left. A review or a plan
  // over a folder or topic already has its notes; any other looks only for notes close in meaning.
  const terms = routedTerms(question, routed)
  const searching = !(advisor && scope !== null && scope.kind !== 'vault')
  const searchStep = searching ? step(ru ? 'Ищу в заметках' : 'Searching notes') : -1
  const named = new Set(names.named.map((n) => n.path))
  let found: Candidate[] = []
  if (searching && (terms.length > 0 || harness.hybridRetrieval)) {
    const hitsByTerm = advisor
      ? []
      : await Promise.all(
          terms.map(async (term) => {
            const response = await indexer({ kind: 'search', query: term, limit: 12 }, 15_000).catch(() => null)
            return response?.kind === 'search-result' ? response.hits : []
          }),
        )
    const ranked = rankNotes(hitsByTerm, exclude).slice(0, 8)
    const ftsNotes = (
      await Promise.all(
        ranked.map(async (r) => {
          const read = await vaultFs.readFile(r.path)
          return read.ok ? { path: r.path, title: path.basename(r.path).replace(/\.md$/i, ''), content: read.content } : null
        }),
      )
    ).filter((n) => n !== null)
    // A follow-up's own words ("where did I write that?") say little: the question before it says what it is about.
    const before = [...messages.slice(0, -1)].reverse().find((m) => m.role === 'user')?.content
    const query = routed !== null && routed.query !== question ? routed.query : before === undefined ? question : `${before}\n${question}`
    const vectorHits = harness.hybridRetrieval
      ? (await searchVectors(query, 20, bot.exclude ?? [])).filter((h) => !advisor || h.score >= ADVISOR_MIN_VECTOR)
      : []
    // An index note is a list of links ("Recto log"), not a note that happens to link a lot ("Lark plan").
    const hubs = new Set(catalog.filter((n) => n.linksOut >= HUB_LINKS && n.size / n.linksOut < HUB_BYTES_PER_LINK).map((n) => n.path))
    found = fuse({ terms, ftsNotes, vectorHits, hubs, named })
    // Sticky context: the pieces the last answers stood on stay in reach, re-ranked with the rest, at most two.
    if (harness.stickyContext && o.sticky !== undefined && o.sticky.length > 0) {
      const have = new Set(found.map((c) => `${c.path}\0${c.heading ?? ''}`))
      let kept = 0
      for (const s of [...o.sticky].reverse()) {
        if (kept === 2 || have.has(`${s.path}\0${s.heading ?? ''}`)) continue
        const read = await vaultFs.readFile(s.path)
        if (!read.ok) continue
        const title = path.basename(s.path).replace(/\.md$/i, '')
        const c = chunkNote(title, read.content).find((x) => (x.path.length === 0 ? null : x.path.join(' > ')) === s.heading)
        if (c === undefined) continue
        // As if it were a top hit: it was good enough for the last answer.
        found.push({
          path: s.path,
          title,
          heading: s.heading,
          text: c.text,
          idx: c.idx,
          key: `${s.path}#${c.idx}`,
          score: 1 / (RRF_K + 1),
          via: ['words'],
        })
        kept++
      }
      found.sort((a, b) => b.score - a.score)
    }
  }
  // Named notes' pieces are already in; the search fills the rest, keeping clear of them.
  const room = Math.max(advisor ? 3 : 4, 6 - pieces.length)
  const rest = pick(
    found.filter((c) => !named.has(c.path)),
    { max: advisor ? 2 : room, budget: Math.max(0, budget - used) },
  )
  if (searchStep >= 0) finish(searchStep, rest[0] === undefined ? (ru ? 'ничего' : 'nothing') : `“${rest[0].title}”`)
  const chunks = [...pieces, ...rest]
  const score = (p: string): number => found.find((c) => c.path === p)?.score ?? 1
  for (const c of chunks) context.push({ path: c.path, title: c.title, heading: c.heading, score: score(c.path) })

  const exampleText = advisor ? bot.examples?.[kind] : undefined
  const head = [
    bot.system.trim(),
    ...(exampleText === undefined ? [] : [`## An example of a good ${kind} answer\n\n${exampleText}`]),
    ...sections,
  ].join('\n\n')
  // Nothing found and nothing looked up: the plain "no notes matched" line.
  const system = buildSystem(head, sections.length === 0 || chunks.length > 0 ? chunks : null)
  // Sources: the pieces read, then the scope's notes - each note once.
  const seen = new Set<string>()
  const sources = context.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)))
  const toolContext: ToolContext = {
    bot,
    catalog,
    vaultNotes,
    folders: foldersOf(catalog),
    topics: topicsOf(catalog),
    toolOptions,
    embed: embedClassify,
    model,
    budget: 4000,
  }
  return finishWith(system, context, { chunks, sources, toolContext })
}
