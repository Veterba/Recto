import { parseFrontmatter } from './frontmatter'

/**
 * Boards as notes, in the file format of the Obsidian Kanban plugin
 * (mgmeyers/obsidian-kanban), so one board opens in both apps.
 *
 * The format, as the plugin reads it:
 * - frontmatter `kanban-plugin: board` (`basic` is the old name of the same);
 * - every heading is a lane, `## To do`, a WIP limit written into it, `## Doing (3)`;
 * - `**Complete**` straight under a heading marks the lane whose cards are done
 *   (ticked `- [x]` as they enter it);
 * - the first list under a heading is its cards, one item each, continued on
 *   lines indented under it;
 * - `***` then `## Archive` holds archived cards;
 * - `%% kanban:settings`, a fenced line of JSON and `%%` end the file. Keys
 *   the plugin does not know survive its saves, which is where Recto keeps its
 *   own, under `recto`.
 *
 * The plugin rewrites the whole file from its model on every save and drops
 * anything else. Recto does the opposite: every edit here changes the lines it
 * means to and no others, so a line Recto does not understand is never moved,
 * dropped or reformatted.
 *
 * Pure: text in, text out.
 */

export const KANBAN_KEY = 'kanban-plugin'

export type KanbanItem = {
  /** First line of the item, in the whole file. */
  start: number
  /** One past its last line (continuation lines included, trailing blank lines not). */
  end: number
  checked: boolean
  /** The character between the brackets, as written (' ' when there is no checkbox). */
  checkChar: string
  /** The text after the checkbox, continuation lines joined with \n and unindented. */
  text: string
  /** The note it names, when the text starts with a `[[link]]`: then it is a card that is a note. */
  link: string | null
  /** The item's lines exactly as written, to find it again after the file changed. */
  raw: string
}

export type KanbanLane = {
  /** The heading's line. */
  line: number
  /** Heading level as written; the plugin writes `##`. */
  level: number
  title: string
  /** A WIP limit, from `Title (3)`. */
  wip: number | null
  /** Has the `**Complete**` line: its cards are done. */
  complete: boolean
  completeLine: number | null
  items: KanbanItem[]
  /** Where the first card goes when the lane has none. */
  emptyAt: number
}

export type KanbanBoard = {
  lanes: KanbanLane[]
  archive: KanbanItem[]
  /** The settings block's JSON, every key kept. */
  settings: Record<string, unknown>
  /** Lines of the settings block (`%% kanban:settings` to `%%`), or null when there is none. */
  settingsLines: { start: number; end: number } | null
  /** The block is there but its JSON does not parse: it is never rewritten then. */
  settingsBroken: boolean
}

/** Recto's own settings for a board, kept in the settings block under `recto`. */
export type RectoBoardSettings = {
  /** Per lane, by title: lanes have no id in the format. */
  lanes?: Record<string, { color?: string; start?: string; due?: string }>
  widgets?: { shown: boolean; list: string[] }
  sort?: string
  /** The boards.json id this board was made from. */
  migratedFrom?: string
}

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const ITEM = /^( {0,3})([-*+])[ \t]+(?:\[(.)\](?:[ \t]+|$))?(.*)$/
const FENCE = /^ {0,3}(```|~~~)/
const BREAK = /^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/
const COMPLETE = /^(?:\*\*Complete\*\*|Complete)$/
const LINK = /^\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/
const SETTINGS_OPEN = '%% kanban:settings'

const lineBreak = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')
const linesOf = (text: string): string[] => text.split(/\r?\n/)
const indented = (line: string): boolean => /^(?: {2,}|\t)/.test(line)
const blank = (line: string): boolean => line.trim() === ''

/** Whether a note is a board: its frontmatter names the plugin. */
export function isKanban(text: string): boolean {
  if (!text.startsWith('---')) return false
  const value = parseFrontmatter(text).fields.find((f) => f.key === KANBAN_KEY)?.value
  return value !== null && value !== undefined && value !== '' && value !== false
}

/** `Doing (3)` -> title and WIP limit, as the plugin reads a lane's heading. */
export function laneTitle(heading: string): { title: string; wip: number | null } {
  const match = /^(.*?)\s*\((\d+)\)$/.exec(heading)
  if (match === null) return { title: heading, wip: null }
  const wip = Number(match[2])
  return { title: match[1]!, wip: wip > 0 ? wip : null }
}

const headingText = (title: string, wip: number | null): string => (wip === null ? title : `${title} (${wip})`)

/** The settings block at the end of the file, found the way the plugin finds it: from the end. */
function findSettings(lines: readonly string[]): { start: number; end: number; json: string } | null {
  let end = lines.length - 1
  while (end >= 0 && blank(lines[end]!)) end--
  if (end < 3 || lines[end]!.trim() !== '%%') return null
  const close = end - 1
  if (!/^```\s*$/.test(lines[close]!)) return null
  let open = close - 1
  while (open >= 0 && !/^```\s*$/.test(lines[open]!)) open--
  if (open < 1 || lines[open - 1]!.trim() !== SETTINGS_OPEN) return null
  return { start: open - 1, end: end + 1, json: lines.slice(open + 1, close).join('\n') }
}

function readItem(lines: readonly string[], at: number, limit: number): KanbanItem {
  const match = ITEM.exec(lines[at]!)!
  let end = at + 1
  // Continuation lines are indented under the item; a blank line belongs to it
  // only when an indented line follows.
  for (let i = at + 1; i < limit; i++) {
    const line = lines[i]!
    if (blank(line)) continue
    if (indented(line)) end = i + 1
    else break
  }
  const body = lines
    .slice(at + 1, end)
    .map((line) => line.replace(/^(?: {4}|\t| {2,3})/, ''))
    .join('\n')
  const first = match[4]!.replace(/\s+\^[A-Za-z0-9-]+$/, '').trimEnd()
  const text = end > at + 1 ? `${first}\n${body}` : first
  const checkChar = match[3] ?? ' '
  return {
    start: at,
    end,
    checked: checkChar !== ' ',
    checkChar,
    text,
    link: LINK.exec(first)?.[1]?.trim() ?? null,
    raw: lines.slice(at, end).join('\n'),
  }
}

/** The first list in `lines[from..to)`, after any paragraphs: its items, or none. */
function readList(lines: readonly string[], from: number, to: number): { items: KanbanItem[]; complete: number | null; first: number | null } {
  let complete: number | null = null
  let i = from
  let fence: string | null = null
  for (; i < to; i++) {
    const line = lines[i]!
    const opens = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (opens === fence) fence = null
      continue
    }
    if (opens !== undefined) {
      fence = opens
      continue
    }
    if (ITEM.test(line)) break
    if (complete === null && COMPLETE.test(line.trim())) complete = i
  }
  if (i >= to) return { items: [], complete, first: null }
  const marker = ITEM.exec(lines[i]!)![2]
  const items: KanbanItem[] = []
  while (i < to) {
    const match = ITEM.exec(lines[i]!)
    if (match === null || match[2] !== marker) break
    const item = readItem(lines, i, to)
    items.push(item)
    i = item.end
    // Blank lines between items keep the list going.
    let next = i
    while (next < to && blank(lines[next]!)) next++
    if (next >= to || !ITEM.test(lines[next]!)) break
    i = next
  }
  return { items, complete, first: items[0]?.start ?? null }
}

export function parseKanban(text: string): KanbanBoard {
  const lines = linesOf(text)
  const bodyStart = text.startsWith('---') ? parseFrontmatter(text).bodyStart : 0
  const block = findSettings(lines)
  const limit = block?.start ?? lines.length

  let settings: Record<string, unknown> = {}
  let settingsBroken = false
  if (block !== null) {
    try {
      const parsed: unknown = JSON.parse(block.json.trim() === '' ? '{}' : block.json)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
      else settingsBroken = true
    } catch {
      settingsBroken = true
    }
  }

  // Headings outside code blocks; each one is a lane, up to the next.
  const headings: { line: number; level: number; text: string }[] = []
  let fence: string | null = null
  for (let i = bodyStart; i < limit; i++) {
    const line = lines[i]!
    const opens = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (opens === fence) fence = null
      continue
    }
    if (opens !== undefined) {
      fence = opens
      continue
    }
    const match = HEADING.exec(line)
    if (match !== null) headings.push({ line: i, level: match[1]!.length, text: match[2]! })
  }

  const lanes: KanbanLane[] = []
  let archive: KanbanItem[] = []
  headings.forEach((heading, n) => {
    const to = headings[n + 1]?.line ?? limit
    const list = readList(lines, heading.line + 1, to)
    // `***` before `## Archive` makes it the archive, not a lane.
    let prev = heading.line - 1
    while (prev >= bodyStart && blank(lines[prev]!)) prev--
    if (heading.text.trim() === 'Archive' && prev >= bodyStart && BREAK.test(lines[prev]!)) {
      archive = list.items
      return
    }
    const { title, wip } = laneTitle(heading.text.trim())
    // A first card goes under the heading (and its Complete line), past one blank line.
    let emptyAt = (list.complete ?? heading.line) + 1
    if (emptyAt < to && blank(lines[emptyAt]!)) emptyAt++
    lanes.push({
      line: heading.line,
      level: heading.level,
      title,
      wip,
      complete: list.complete !== null,
      completeLine: list.complete,
      items: list.items,
      emptyAt: Math.min(emptyAt, to),
    })
  })

  return {
    lanes,
    archive,
    settings,
    settingsLines: block === null ? null : { start: block.start, end: block.end },
    settingsBroken,
  }
}

/** Recto's settings out of a board's settings block, read defensively: a person may have edited it. */
export function rectoSettings(board: KanbanBoard): RectoBoardSettings {
  const raw = board.settings['recto']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const out: RectoBoardSettings = {}
  if (typeof record['sort'] === 'string') out.sort = record['sort']
  if (typeof record['migratedFrom'] === 'string') out.migratedFrom = record['migratedFrom']
  const lanes = record['lanes']
  if (lanes !== null && typeof lanes === 'object' && !Array.isArray(lanes)) {
    out.lanes = {}
    for (const [title, value] of Object.entries(lanes as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      const lane: { color?: string; start?: string; due?: string } = {}
      for (const key of ['color', 'start', 'due'] as const) if (typeof v[key] === 'string') lane[key] = v[key] as string
      out.lanes[title] = lane
    }
  }
  const widgets = record['widgets']
  if (widgets !== null && typeof widgets === 'object' && !Array.isArray(widgets)) {
    const w = widgets as Record<string, unknown>
    const list = Array.isArray(w['list']) ? w['list'].filter((id): id is string => typeof id === 'string') : []
    out.widgets = { shown: w['shown'] !== false, list: [...new Set(list)] }
  }
  return out
}

// --- edits ---------------------------------------------------------------------

export type ItemRef = { lane: number; index: number }

function splice(text: string, start: number, remove: number, insert: readonly string[]): string {
  const eol = lineBreak(text)
  const lines = linesOf(text)
  lines.splice(start, remove, ...insert)
  return lines.join(eol)
}

const itemAt = (board: KanbanBoard, ref: ItemRef): KanbanItem => {
  const item = board.lanes[ref.lane]?.items[ref.index]
  if (item === undefined) throw new Error('That card is no longer on the board.')
  return item
}

/**
 * Where an item is now: at `ref` if it still reads `raw` there, else the first
 * item anywhere on the board that does, else null. Edits are worked out from
 * what was on screen, and the file can change under it (Obsidian, sync).
 */
export function findItem(board: KanbanBoard, ref: ItemRef, raw: string): ItemRef | null {
  if (board.lanes[ref.lane]?.items[ref.index]?.raw === raw) return ref
  for (const [lane, entry] of board.lanes.entries()) {
    const index = entry.items.findIndex((item) => item.raw === raw)
    if (index !== -1) return { lane, index }
  }
  return null
}

/** The item's lines with the checkbox set (one character changes), adding `[ ]` where there was none. */
function withCheck(raw: string, checked: boolean): string {
  const lines = raw.split('\n')
  const match = ITEM.exec(lines[0]!)!
  const char = checked ? 'x' : ' '
  if (match[3] !== undefined) {
    if ((match[3] !== ' ') === checked) return raw
    lines[0] = lines[0]!.replace(/\[(.)\]/, `[${char}]`)
  } else {
    lines[0] = lines[0]!.replace(/^( {0,3}[-*+][ \t]+)/, `$1[${char}] `)
  }
  return lines.join('\n')
}

/** Tick or untick one card. */
export function setChecked(text: string, ref: ItemRef, checked: boolean): string {
  const item = itemAt(parseKanban(text), ref)
  const next = withCheck(item.raw, checked)
  return next === item.raw ? text : splice(text, item.start, item.end - item.start, next.split('\n'))
}

/** The line a card would be inserted at to land at `index` of a lane. */
function insertionLine(lane: KanbanLane, index: number): number {
  if (lane.items.length === 0) return lane.emptyAt
  if (index < lane.items.length) return lane.items[Math.max(0, index)]!.start
  return lane.items.at(-1)!.end
}

/**
 * Move a card to slot `to.index` of lane `to.lane` (counted without the card
 * itself). Only its own lines move; `checked`, when given, sets its box on
 * the way - entering or leaving the done lane.
 */
export function moveItem(text: string, from: ItemRef, to: { lane: number; index: number }, checked?: boolean): string {
  const board = parseKanban(text)
  const item = itemAt(board, from)
  const lines = (checked === undefined ? item.raw : withCheck(item.raw, checked)).split('\n')
  const removed = splice(text, item.start, item.end - item.start, [])
  const after = parseKanban(removed)
  const lane = after.lanes[to.lane]
  if (lane === undefined) throw new Error('That column is no longer on the board.')
  const at = insertionLine(lane, Math.min(to.index, lane.items.length))
  return splice(removed, at, 0, emptyLaneLines(lane, removed, at, lines))
}

/** A card going into an empty lane brings the blank line the list needs before the next heading. */
function emptyLaneLines(lane: KanbanLane, text: string, at: number, lines: readonly string[]): string[] {
  if (lane.items.length > 0) return [...lines]
  const next = linesOf(text)[at]
  return next === undefined || blank(next) ? [...lines] : [...lines, '']
}

/** A new card, `- [ ] content`, at slot `index` of a lane (0 is the top). */
export function insertItem(text: string, laneIndex: number, index: number, content: string, checked = false): string {
  const lane = parseKanban(text).lanes[laneIndex]
  if (lane === undefined) throw new Error('That column is no longer on the board.')
  const line = `- [${checked ? 'x' : ' '}] ${content}`
  const at = insertionLine(lane, index)
  return splice(text, at, 0, emptyLaneLines(lane, text, at, [line]))
}

/** Replace a card's lines with one line of new content, keeping its checkbox. */
export function replaceItem(text: string, ref: ItemRef, content: string): string {
  const item = itemAt(parseKanban(text), ref)
  const indent = /^( {0,3}[-*+][ \t]+)/.exec(item.raw)![1]
  return splice(text, item.start, item.end - item.start, [`${indent}[${item.checkChar}] ${content}`])
}

/** Take a card off the board: its lines go, nothing else. */
export function removeItem(text: string, ref: ItemRef): string {
  const item = itemAt(parseKanban(text), ref)
  return splice(text, item.start, item.end - item.start, [])
}

function laneAt(text: string, index: number): KanbanLane {
  const lane = parseKanban(text).lanes[index]
  if (lane === undefined) throw new Error('That column is no longer on the board.')
  return lane
}

/** Rewrite one lane's heading: its title and WIP limit. */
export function setLaneHeading(text: string, index: number, title: string, wip: number | null): string {
  const lane = laneAt(text, index)
  return splice(text, lane.line, 1, [`${'#'.repeat(lane.level)} ${headingText(title, wip)}`])
}

/** Mark a lane as the done lane, or unmark it: the `**Complete**` line under its heading. */
export function setLaneComplete(text: string, index: number, on: boolean): string {
  const lane = laneAt(text, index)
  if (on === lane.complete) return text
  if (!on) return splice(text, lane.completeLine!, 1, [])
  const lines = linesOf(text)
  // The plugin writes it after the heading's blank line, right above the cards.
  const at = lane.line + 1 < lines.length && blank(lines[lane.line + 1]!) ? lane.line + 2 : lane.line + 1
  return splice(text, at, 0, ['**Complete**'])
}

/** A new, empty lane after the last one - before the archive and the settings block. */
export function addLane(text: string, title: string): string {
  const board = parseKanban(text)
  const lines = linesOf(text)
  let at = archiveStart(lines, board) ?? board.settingsLines?.start ?? lines.length
  while (at > 0 && blank(lines[at - 1]!)) at--
  if (board.lanes.length === 0 && at < parseFrontmatter(text).bodyStart) at = parseFrontmatter(text).bodyStart
  return splice(text, at, 0, ['', '', `## ${title}`, ''])
}

/** The `***` line that opens the archive, if any. */
function archiveStart(lines: readonly string[], board: KanbanBoard): number | null {
  if (board.archive.length === 0) {
    const heading = lines.findIndex((line, i) => /^#{1,6}\s+Archive\s*$/.test(line) && i > 0)
    if (heading === -1) return null
    let prev = heading - 1
    while (prev >= 0 && blank(lines[prev]!)) prev--
    return prev >= 0 && BREAK.test(lines[prev]!) ? prev : null
  }
  let prev = board.archive[0]!.start
  while (prev >= 0 && !BREAK.test(lines[prev]!)) prev--
  return prev >= 0 ? prev : null
}

/** Delete a lane that holds no cards: its heading through the line before the next. */
export function removeLane(text: string, index: number): string {
  const board = parseKanban(text)
  const lane = board.lanes[index]
  if (lane === undefined) return text
  if (lane.items.length > 0) throw new Error('Move its cards out first.')
  const lines = linesOf(text)
  const next = board.lanes[index + 1]?.line ?? archiveStart(lines, board) ?? board.settingsLines?.start ?? lines.length
  return splice(text, lane.line, next - lane.line, [])
}

/**
 * Change the settings block: every key in it is kept, `change` decides the
 * new object. A block that does not parse is left alone - writing over it
 * would destroy what someone wrote there.
 */
export function updateSettings(text: string, change: (settings: Record<string, unknown>) => Record<string, unknown>): string {
  const board = parseKanban(text)
  if (board.settingsBroken) throw new Error("The board's settings block can't be read, so it was left as it is.")
  const next = change({ ...board.settings })
  const block = [SETTINGS_OPEN, '```', JSON.stringify(next), '```', '%%']
  if (board.settingsLines !== null) return splice(text, board.settingsLines.start, board.settingsLines.end - board.settingsLines.start, block)
  // No block yet: at the end, two blank lines after the rest, as the plugin writes it.
  const eol = lineBreak(text)
  const body = text.replace(/\s+$/, '')
  return `${body}${eol}${eol}${eol}${block.join(eol)}`
}

/** Merge into Recto's settings in the block; an `undefined` value removes a key. */
export function updateRecto(text: string, patch: Partial<Record<keyof RectoBoardSettings, unknown>>): string {
  return updateSettings(text, (settings) => {
    const current = settings['recto']
    const recto: Record<string, unknown> = current !== null && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete recto[key]
      else recto[key] = value
    }
    return Object.keys(recto).length === 0 ? omit(settings, 'recto') : { ...settings, recto }
  })
}

const omit = (record: Record<string, unknown>, key: string): Record<string, unknown> => {
  const { [key]: _gone, ...rest } = record
  return rest
}

// --- whole boards ----------------------------------------------------------------

export type NewLane = { title: string; wip?: number | null; complete?: boolean; items: { text: string; checked?: boolean }[] }

/**
 * A board written from scratch, in the plugin's own layout - byte for byte
 * what its `boardToMd` writes, so the first Obsidian save of it changes nothing.
 */
export function boardText(lanes: readonly NewLane[], settings: Record<string, unknown> = {}): string {
  const out = ['---', '', `${KANBAN_KEY}: board`, '', '---', '', '']
  let body = out.join('\n')
  for (const lane of lanes) {
    const lines = [`## ${headingText(lane.title, lane.wip ?? null)}`, '']
    if (lane.complete === true) lines.push('**Complete**')
    for (const item of lane.items) lines.push(`- [${item.checked === true ? 'x' : ' '}] ${item.text.replace(/\n/g, '\n    ')}`)
    lines.push('', '', '')
    body += lines.join('\n')
  }
  const json = JSON.stringify({ [KANBAN_KEY]: 'board', ...settings })
  return `${body}${['', '', SETTINGS_OPEN, '```', json, '```', '%%'].join('\n')}`
}

/** `[[Name]]` for a card line: the name, with what a link cannot hold left out. */
export const cardLink = (name: string): string => `[[${name}]]`

/** The lane a card counts as done in: the one marked Complete, else one called Done. */
export function doneLane(lanes: readonly Pick<KanbanLane, 'title' | 'complete'>[]): number {
  const marked = lanes.findIndex((lane) => lane.complete)
  if (marked !== -1) return marked
  return lanes.findIndex((lane) => /^(done|complete|completed|finished|готово|сделано)$/i.test(lane.title.trim()))
}

/** Where a card stands on one board: its first lane, done, or anywhere between. */
export type CardStage = 'open' | 'doing' | 'done'

export function stageOf(lane: number, lanes: readonly Pick<KanbanLane, 'title' | 'complete'>[]): CardStage {
  if (lane === doneLane(lanes)) return 'done'
  return lane === 0 ? 'open' : 'doing'
}

/** One icon for a note on several boards: their stage when they agree, `mixed` when not. */
export function linkStage(stages: readonly CardStage[]): CardStage | 'mixed' | null {
  if (stages.length === 0) return null
  return stages.every((stage) => stage === stages[0]) ? stages[0]! : 'mixed'
}
