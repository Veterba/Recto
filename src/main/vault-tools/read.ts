import { vaultFiles } from '../vault-fs'
import fs from 'node:fs'
import path from 'node:path'
import { groupTasks } from '../../shared/tasks'
import { isExcludedPath } from '../../shared/ai-access'
import { isChatPath } from '../../shared/recto-paths'
import type { IndexRequest, IndexResponse, VaultMeta } from '../../shared/indexer-protocol'
import { cardDescription, cardFields, readPriority, readTags } from '../../shared/card-fields'
import { bodyOf } from '../../shared/frontmatter'
import { doneLane, isKanban, parseKanban } from '../../shared/kanban'
import { parseNote } from '../../shared/parse'
import { periodNotePath } from '../../shared/periodic'
import { type Period } from '../../shared/templates'
import type { ResultBlock } from '../../shared/vault-tools'
import { send } from '../index-client'
import { searchVectors } from '../bots/vectors'
import { folderOf, readNote, titleOf, ToolError, type Scope } from './scope'

/**
 * The read tools. Every result is filtered by the scope: an excluded note is
 * never a hit, a backlink, a summary, a tag count or a task - and a board
 * line that links one shows as "(excluded note)".
 */

type Args = Record<string, unknown>
const data = (value: unknown): ResultBlock => ({ kind: 'data', data: value })
const noteBlock = (p: string, text: string, part?: string): ResultBlock => ({
  kind: 'note',
  path: p,
  text,
  ...(part === undefined ? {} : { part }),
})

export async function ask<K extends IndexResponse['kind']>(request: IndexRequest, kind: K): Promise<Extract<IndexResponse, { kind: K }>> {
  let response: IndexResponse
  try {
    response = await send(request, 60_000)
  } catch (err) {
    throw new ToolError(`Recto's index is not ready yet (${err instanceof Error ? err.message : String(err)}). Try again in a moment.`)
  }
  if (response.kind !== kind) throw new ToolError("Recto's index gave an unexpected answer. Try again in a moment.")
  return response as Extract<IndexResponse, { kind: K }>
}

/** The index's notes, tags and properties, the hidden ones left out. */
export async function visibleMeta(scope: Scope): Promise<VaultMeta> {
  const { meta } = await ask({ kind: 'vault-meta' }, 'vault-meta-result')
  const ok = (row: { path: string }): boolean => !scope.hidden(row.path)
  const properties = meta.properties.filter(ok)
  // Tags are written inline (#tag) and in the tags property; both are the note's tags.
  const tags = new Map<string, { path: string; tag: string }>()
  for (const t of meta.tags.filter(ok)) tags.set(`${t.path}\0${t.tag.toLowerCase()}`, t)
  for (const p of properties)
    if (p.key === 'tags')
      for (const tag of readTags(p.value))
        if (!tags.has(`${p.path}\0${tag.toLowerCase()}`)) tags.set(`${p.path}\0${tag.toLowerCase()}`, { path: p.path, tag })
  return { notes: meta.notes.filter(ok), tags: [...tags.values()], properties }
}

const page = <T>(items: readonly T[], limit: number, cursor: unknown): { items: T[]; next_cursor?: string } => {
  const start = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : 0
  const items_ = items.slice(start, start + limit)
  return start + limit < items.length ? { items: items_, next_cursor: String(start + limit) } : { items: items_ }
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const inFolder = (p: string, folder: string): boolean => {
  const f = folder.replace(/^\/+|\/+$/g, '').toLowerCase()
  return f === '' || p.toLowerCase().startsWith(`${f}/`)
}

export async function getAiGuide(scope: Scope): Promise<ResultBlock[]> {
  const guide = scope.settings.guide
  if (guide === null || !fs.existsSync(path.join(scope.vault, guide)))
    return [
      data({ path: null, hint: 'The person has not chosen an AI guide (Recto: Settings → AI → AI guide). Follow the vault profile.' }),
    ]
  // Excluded since it was chosen: no tool returns a note AI may not see, the guide neither. Only the
  // exclusions count: a session that sees a few notes (Quick ask) still gets the person's guide.
  if (isChatPath(guide) || isExcludedPath(guide, scope.settings.excluded))
    return [data({ path: null, hint: 'The AI guide is in a folder AI may not see (Settings → AI → Excluded). Follow the vault profile.' })]
  // Not a note the answer is about: kept out of its record (vault-tools/index.ts).
  return [data({ path: guide }), noteBlock(guide, await readNote(guide), 'guide')]
}

export async function searchNotes(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const query = typeof a['query'] === 'string' ? a['query'] : null
  const mode = a['mode'] as 'text' | 'semantic' | 'both'
  const meta = await visibleMeta(scope)
  const mtime = new Map(meta.notes.map((n) => [n.path, n.mtime]))
  // A tag takes its nested tags too: "project" finds "project/recto", as Obsidian's tag search does.
  const wantTag = typeof a['tag'] === 'string' ? String(a['tag']).replace(/^#/, '').toLowerCase() : null
  const tagged =
    wantTag !== null
      ? new Set(meta.tags.filter((t) => t.tag.toLowerCase() === wantTag || t.tag.toLowerCase().startsWith(`${wantTag}/`)).map((t) => t.path))
      : null
  const wantKey = typeof a['property'] === 'string' ? a['property'].trim().toLowerCase() : null
  const wantValue = typeof a['value'] === 'string' ? a['value'].trim().toLowerCase() : null
  if (wantValue !== null && wantKey === null) throw new ToolError('Give property with value: the key whose value it is.')
  const owned =
    wantKey !== null
      ? new Set(
          meta.properties
            .filter((p) => p.key.toLowerCase() === wantKey && (wantValue === null || valuesOf(p.value).includes(wantValue)))
            .map((p) => p.path),
        )
      : null
  const after = typeof a['modified_after'] === 'string' ? a['modified_after'] : null
  const before = typeof a['modified_before'] === 'string' ? a['modified_before'] : null
  const keep = (p: string): boolean => {
    if (!mtime.has(p)) return false
    if (typeof a['folder'] === 'string' && !inFolder(p, a['folder'])) return false
    if (tagged !== null && !tagged.has(p)) return false
    if (owned !== null && !owned.has(p)) return false
    const day = isoDate(mtime.get(p)!)
    return (after === null || day >= after) && (before === null || day <= before)
  }

  // Reciprocal rank fusion of the two lists, as the bots do (bots/retrieve.ts).
  const hits = new Map<string, { score: number; snippet: string; by: Set<'text' | 'semantic'> }>()
  const add = (p: string, rank: number, snippet: string, by: 'text' | 'semantic'): void => {
    const hit = hits.get(p) ?? { score: 0, snippet, by: new Set() }
    hit.score += 1 / (60 + rank + 1)
    hit.by.add(by)
    hits.set(p, hit)
  }
  // The filters go to the index with the query: filtered after its top 200 of the whole vault, a folder's
  // notes past those 200 were never found.
  const filtered = typeof a['folder'] === 'string' || tagged !== null || owned !== null || after !== null || before !== null
  // No query: the notes the filters pick, newest first - "every note tagged #book" needs no words to search for.
  if (query === null) {
    if (!filtered) throw new ToolError('Give a query, or a filter (folder, tag, property, a date) to list the notes it picks.')
    const picked = meta.notes.filter((n) => keep(n.path)).sort((x, y) => y.mtime - x.mtime)
    const { items, next_cursor } = page(picked, Number(a['limit']), a['cursor'])
    return [
      data({
        notes: items.map((n) => ({ path: n.path, title: titleOf(n.path), modified: isoDate(n.mtime) })),
        total: picked.length,
        ...(next_cursor === undefined ? {} : { next_cursor }),
      }),
    ]
  }
  if (mode !== 'semantic') {
    const paths = meta.notes.map((n) => n.path).filter(keep)
    const { hits: text } = await ask({ kind: 'search', query, limit: 200, paths }, 'search-result')
    text.filter((h) => keep(h.path)).forEach((h, i) => add(h.path, i, h.snippet, 'text'))
  }
  let semantic = false
  if (mode !== 'text') {
    // By meaning, the nearest chunks are taken first and filtered after: a wider net when filters will thin it.
    const found = await searchVectors(query, filtered ? 400 : 60, scope.settings.excluded)
    semantic = found.length > 0
    const best = new Map<string, (typeof found)[number]>()
    for (const h of found) if (keep(h.path) && !best.has(h.path)) best.set(h.path, h)
    ;[...best.values()].forEach((h, i) => add(h.path, i, h.text.slice(0, 240), 'semantic'))
  }
  const ranked = [...hits.entries()].sort((x, y) => y[1].score - x[1].score)
  const { items, next_cursor } = page(ranked, Number(a['limit']), a['cursor'])
  return [
    data({
      hits: items.map(([p, h]) => ({
        path: p,
        title: titleOf(p),
        score: Number(h.score.toFixed(4)),
        matched_by: h.by.size === 2 ? 'both' : [...h.by][0],
      })),
      ...(next_cursor === undefined ? {} : { next_cursor }),
      ...(mode !== 'text' && !semantic
        ? { note: 'Search by meaning is not available (no embedding model on this Mac, or nothing indexed yet): these are word matches.' }
        : {}),
    }),
    ...items.map(([p, h]) => noteBlock(p, h.snippet, 'snippet')),
  ]
}

export async function readNoteTool(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const p = scope.need(String(a['note']))
  const content = await readNote(p)
  const parsed = parseNote(content)
  const offset = Number(a['offset'])
  const max = Number(a['max_chars'])
  const text = content.slice(offset, offset + max)
  // All of it, or a part: what the answer's record calls a read in full.
  const whole = offset <= 0 && offset + max >= content.length
  // The note is on disk whether or not the index is ready: only its backlinks wait for the index.
  const links = await ask({ kind: 'backlinks', path: p }, 'backlinks-result').then(
    (r) => r.links,
    () => null,
  )
  const stat = fs.statSync(path.join(scope.vault, p))
  return [
    data({
      path: p,
      title: titleOf(p),
      frontmatter: parsed.frontmatter,
      modified: new Date(stat.mtimeMs).toISOString(),
      truncated: offset + max < content.length,
      ...(offset + max < content.length ? { next_offset: offset + max } : {}),
      links_out: [...new Set(parsed.links.map((l) => l.target))].map((target) => ({
        target,
        // Null when this call may not read it; `exists` says whether it is there at all.
        path: scope.resolve(target, p),
        exists: scope.exists(target, p),
      })),
      ...(links === null
        ? { backlinks: null, backlinks_note: "Recto's index is not ready yet, so backlinks are not listed this time. The note's text is complete." }
        : { backlinks: links.filter((l) => !scope.hidden(l.path)).map((l) => ({ path: l.path, line: l.line })) }),
    }),
    noteBlock(p, text, whole ? undefined : 'excerpt'),
  ]
}

/** A note in a few lines: its first paragraph and its headings - no model is started for a tool call. */
const summary = (content: string): string => {
  const parsed = parseNote(content)
  const first = cardDescription(bodyOf(content))
  const heads = parsed.headings.map((h) => h.text).slice(0, 8)
  return [first, heads.length > 0 ? `Sections: ${heads.join(' · ')}` : ''].filter((s) => s !== '').join('\n')
}

export async function noteContext(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const p = scope.need(String(a['note']))
  const content = await readNote(p)
  let budget = Number(a['budget_tokens']) * 4
  const excerpt = content.slice(0, Math.min(content.length, Math.floor(budget / 3)))
  budget -= excerpt.length
  const out = parseNote(content)
    .links.map((l) => scope.resolve(l.target, p))
    .filter((t): t is string => t !== null && t !== p)
  const { links } = await ask({ kind: 'backlinks', path: p }, 'backlinks-result')
  const related = [
    ...[...new Set(out)].map((path_) => ({ path: path_, direction: 'out' as const })),
    ...[...new Set(links.map((l) => l.path))]
      .filter((s) => !scope.hidden(s) && s !== p)
      .map((path_) => ({ path: path_, direction: 'in' as const })),
  ]
  const blocks: ResultBlock[] = []
  const shown: { path: string; title: string; direction: 'in' | 'out' }[] = []
  for (const r of related) {
    if (budget < 200) break
    const read = await readNote(r.path).catch(() => null)
    if (read === null) continue
    const text = summary(read).slice(0, Math.min(800, budget))
    budget -= text.length
    shown.push({ ...r, title: titleOf(r.path) })
    blocks.push(noteBlock(r.path, text, 'summary'))
  }
  // Every link the note has, found or not - so a note beyond reach, or one left out for room, is never taken for a missing one.
  const linkList = [...new Set(parseNote(content).links.map((l) => l.target))].map((target) => ({
    target,
    exists: scope.exists(target, p),
    readable: scope.resolve(target, p) !== null || scope.resolveFile(target, p) !== null,
  }))
  return [
    data({
      note: { path: p, title: titleOf(p), excerpt_truncated: excerpt.length < content.length },
      links: linkList,
      backlinks: new Set(links.map((l) => l.path).filter((s) => !scope.hidden(s))).size,
      related: shown,
      omitted: related.length - shown.length,
    }),
    // The whole note when it fits: then it is a read, not an excerpt.
    excerpt.length < content.length ? noteBlock(p, excerpt, 'excerpt') : noteBlock(p, excerpt),
    ...blocks,
  ]
}

export async function listFolder(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const folder = String(a['folder']).replace(/^\/+|\/+$/g, '')
  if (folder !== '' && scope.hidden(`${folder}/x.md`)) throw new ToolError(`No folder “${folder}”.`)
  const withFiles = a['files'] === true
  // Files that are not notes, when asked for: the ones AI may see (not excluded, not Recto's chats).
  const others = withFiles ? vaultFiles().filter((p) => !p.toLowerCase().endsWith('.md') && !scope.fileHidden(p)) : []
  const inside = [...scope.notes, ...others].filter((p) => inFolder(p, folder))
  const subfolders = new Map<string, number>()
  const here: string[] = []
  for (const p of inside) {
    const rest = folder === '' ? p : p.slice(folder.length + 1)
    if (rest.includes('/')) {
      const sub = `${folder === '' ? '' : `${folder}/`}${rest.slice(0, rest.indexOf('/'))}`
      subfolders.set(sub, (subfolders.get(sub) ?? 0) + 1)
    } else here.push(p)
  }
  if (folder !== '' && inside.length === 0) throw new ToolError(`No folder “${folder}” with ${withFiles ? 'anything' : 'notes'} in it.`)
  // Modified times from the index, not a disk read of every entry before the page is cut.
  const modified = new Map((await visibleMeta(scope)).notes.map((n) => [n.path, n.mtime]))
  const entries = [
    ...[...subfolders.entries()].sort().map(([p, n]) => ({ type: 'folder', path: p, [withFiles ? 'items' : 'notes']: n })),
    ...here.sort().map((p) =>
      p.toLowerCase().endsWith('.md')
        ? { type: 'note', path: p, title: titleOf(p), ...(modified.has(p) ? { modified: isoDate(modified.get(p)!) } : {}) }
        : { type: 'file', path: p },
    ),
  ]
  const { items, next_cursor } = page(entries, Number(a['limit']), a['cursor'])
  return [data({ folder, entries: items, total: entries.length, ...(next_cursor === undefined ? {} : { next_cursor }) })]
}

export async function recentNotes(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const meta = await visibleMeta(scope)
  const since = typeof a['since'] === 'string' ? a['since'] : null
  const folder = typeof a['folder'] === 'string' ? a['folder'] : null
  const notes = meta.notes
    .filter((n) => (since === null || isoDate(n.mtime) >= since) && (folder === null || inFolder(n.path, folder)))
    .sort((x, y) => y.mtime - x.mtime)
  const { items, next_cursor } = page(notes, Number(a['limit']), a['cursor'])
  return [
    data({
      notes: items.map((n) => ({ path: n.path, title: titleOf(n.path), modified: new Date(n.mtime).toISOString() })),
      total: notes.length,
      ...(next_cursor === undefined ? {} : { next_cursor }),
    }),
  ]
}

export async function listTags(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const meta = await visibleMeta(scope)
  const prefix = typeof a['prefix'] === 'string' ? a['prefix'].replace(/^#/, '').toLowerCase() : ''
  const counts = new Map<string, number>()
  for (const t of meta.tags) if (t.tag.toLowerCase().startsWith(prefix)) counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1)
  const all = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([tag, count]) => ({ tag, count }))
  const { items, next_cursor } = page(all, Number(a['limit']), a['cursor'])
  return [data({ tags: items, total: all.length, ...(next_cursor === undefined ? {} : { next_cursor }) })]
}

/** A property's value as the words it holds, lower-cased: a list's items each, a scalar alone. */
function valuesOf(value: string | null): string[] {
  if (value === null) return []
  const t = value.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      const parsed = JSON.parse(t) as unknown
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim().toLowerCase())
    } catch {
      // Not JSON: a YAML flow list, split by hand.
      return t.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '').toLowerCase())
    }
  }
  return [t.replace(/^["']|["']$/g, '').toLowerCase()]
}

/** A date argument (YYYY-MM-DD) or today, at local noon so no time zone moves it a day. */
export const dateArg = (value: unknown): Date => {
  if (typeof value !== 'string') return new Date()
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) throw new ToolError(`“${value}” is not a date. Use YYYY-MM-DD.`)
  return d
}

/** Where this period's note for this date is, or a ToolError when the period is off. */
export function periodicPlace(scope: Scope, period: Period, date: Date): { path: string; key: string } {
  const settings = scope.templates.periodic
  if (!settings[period].enabled) {
    const on = (['daily', 'weekly', 'monthly', 'yearly'] as const).filter((p) => settings[p].enabled)
    throw new ToolError(
      `${period[0]!.toUpperCase()}${period.slice(1)} notes are off in this vault (Recto: Settings → Periodic notes). ${on.length === 0 ? 'No periodic notes are on.' : `On: ${on.join(', ')}.`}`,
    )
  }
  const place = periodNotePath(period, date, settings)
  if (scope.hidden(place.path)) throw new ToolError(`The ${period} note is in a folder the person excluded from AI.`)
  return { path: place.path, key: place.key }
}

export async function getPeriodicNote(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const period = a['period'] as Period
  if (!scope.templates.periodic[period].enabled) return [data({ period, enabled: false, hint: `${period} notes are off in this vault.` })]
  const place = periodicPlace(scope, period, dateArg(a['date']))
  const exists = fs.existsSync(path.join(scope.vault, place.path))
  const template = scope.templates.periodic[period].template
  return [
    data({
      period,
      enabled: true,
      path: place.path,
      exists,
      template,
      ...(exists ? {} : { hint: 'Not made yet: propose_append with periodic makes it from its template.' }),
    }),
    ...(exists ? [noteBlock(place.path, await readNote(place.path))] : []),
  ]
}

/** The visible boards, read and parsed. */
export async function boards(scope: Scope): Promise<{ path: string; text: string }[]> {
  const { boards: list } = await ask({ kind: 'boards' }, 'boards-result')
  const out: { path: string; text: string }[] = []
  for (const b of list) {
    if (scope.hidden(b.path)) continue
    const text = await readNote(b.path).catch(() => null)
    if (text !== null && isKanban(text)) out.push({ path: b.path, text })
  }
  return out
}

export async function listBoards(scope: Scope): Promise<ResultBlock[]> {
  return [
    data(
      (await boards(scope)).map((b) => ({
        path: b.path,
        name: titleOf(b.path),
        lanes: parseKanban(b.text).lanes.map((l) => ({ title: l.title, cards: l.items.length })),
      })),
    ),
  ]
}

export async function findBoard(scope: Scope, target: string): Promise<{ path: string; text: string }> {
  const p = scope.resolve(target)
  const all = await boards(scope)
  const board = all.find((b) => b.path === p) ?? all.find((b) => titleOf(b.path).toLowerCase() === target.trim().toLowerCase())
  if (board === undefined) throw new ToolError(`No board “${target}”. Boards: ${all.map((b) => titleOf(b.path)).join(', ') || 'none'}.`)
  return board
}

type CardInfo = { text: string; note: string | null; checked: boolean; due?: string; priority?: string; tags?: string[] }

async function cardInfo(scope: Scope, board: string, item: { text: string; link: string | null; checked: boolean }): Promise<CardInfo> {
  if (item.link === null) return { text: item.text, note: null, checked: item.checked }
  const p = scope.resolve(item.link, board)
  // A card whose note is excluded: it is there, and nothing more is said.
  if (p === null)
    return scope.allNotes.some((n) => n.toLowerCase().endsWith(`/${item.link!.toLowerCase()}.md`))
      ? { text: '(excluded note)', note: null, checked: item.checked }
      : { text: item.text, note: null, checked: item.checked }
  const content = await readNote(p).catch(() => null)
  const fields = content === null ? null : cardFields(content)
  return {
    text: item.text,
    note: p,
    checked: item.checked,
    ...(fields?.due === null || fields === null ? {} : { due: fields.due }),
    ...(fields === null || readPriority(fields.priority) === null ? {} : { priority: readPriority(fields.priority)! }),
    ...(fields === null || readTags(fields.tags).length === 0 ? {} : { tags: readTags(fields.tags) }),
  }
}

export async function readBoard(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const board = await findBoard(scope, String(a['board']))
  const parsed = parseKanban(board.text)
  const done = doneLane(parsed.lanes)
  const lanes = []
  for (const [i, lane] of parsed.lanes.entries())
    lanes.push({
      title: lane.title,
      ...(lane.wip === null ? {} : { wip: lane.wip }),
      done_lane: i === done,
      cards: await Promise.all(lane.items.map((item) => cardInfo(scope, board.path, item))),
    })
  return [data({ path: board.path, name: titleOf(board.path), lanes })]
}

export async function listTasks(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const status = a['status'] as 'open' | 'done' | 'all'
  const { rows } = await ask({ kind: 'task-rows', since: '0000-01-01', to: '9999-12-31' }, 'task-rows-result')
  const wantBoard = typeof a['board'] === 'string' ? a['board'].toLowerCase() : null
  const tasks = []
  // Each note read once per call, however many of its tasks are listed: a card's fields, a task's line.
  const texts = new Map<string, Promise<string | null>>()
  const textOf = (p: string): Promise<string | null> => {
    let t = texts.get(p)
    if (t === undefined) texts.set(p, (t = readNote(p).catch(() => null)))
    return t
  }
  /** The 1-based line of a "- [ ]" task with this text in its note: what propose_task_update takes to tick it. */
  const lineOf = async (p: string, text: string): Promise<number | null> => {
    const content = await textOf(p)
    if (content === null) return null
    const lines = content.split(/\r?\n/)
    const at = lines.findIndex((l) => {
      const m = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+(.*)$/.exec(l)
      return m !== null && m[1]!.trim() === text.trim()
    })
    return at === -1 ? null : at + 1
  }
  // A task carried from daily note to daily note is one task, as the person's task views count it (shared/tasks.ts):
  // open or done as its latest copy says, listed at that copy.
  for (const group of groupTasks(rows.filter((r) => !scope.hidden(r.path)))) {
    const row = group.occurrences.at(-1)!
    if (status === 'open' && row.done) continue
    if (status === 'done' && !row.done) continue
    if (wantBoard !== null && (row.board ?? '').toLowerCase() !== wantBoard && titleOf(row.board ?? '').toLowerCase() !== wantBoard)
      continue
    if (typeof a['due_before'] === 'string' && (row.due === null || row.due.slice(0, 10) > a['due_before'])) continue
    if (typeof a['due_after'] === 'string' && (row.due === null || row.due.slice(0, 10) < a['due_after'])) continue
    let priority: string | null = null
    if (row.source === 'card' || a['priority'] !== undefined) {
      const content = row.source === 'card' ? await textOf(row.path) : null
      priority = content === null ? null : readPriority(cardFields(content).priority)
    }
    if (a['priority'] !== undefined && priority !== a['priority']) continue
    const line = row.source === 'card' ? null : await lineOf(row.path, row.text)
    tasks.push({
      text: row.text,
      path: row.path,
      source: row.source === 'card' ? 'card' : 'note',
      // How to change it with propose_task_update: a card by its board and name, a note's task by its note and line.
      ...(row.source === 'card' ? { card: titleOf(row.path) } : line === null ? {} : { line }),
      ...(row.board === null ? {} : { board: row.board }),
      status: row.done ? 'done' : 'open',
      ...(row.due === null ? {} : { due: row.due }),
      ...(priority === null ? {} : { priority }),
      ...(group.occurrences.length > 1 ? { carried_since: group.since, copies: group.occurrences.length } : {}),
    })
  }
  const { items, next_cursor } = page(tasks, Number(a['limit']), a['cursor'])
  return [data({ tasks: items, ...(next_cursor === undefined ? {} : { next_cursor }) })]
}

export { data, noteBlock, folderOf }
