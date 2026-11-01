import fs from 'node:fs'
import path from 'node:path'
import type { FileChange } from '../../shared/ai-access'
import { setCardField } from '../../shared/card-fields'
import { formatChanged, type FormatContext } from '../../shared/formatting'
import { setField } from '../../shared/frontmatter'
import { cardLink, doneLane, insertItem, isKanban, moveItem, parseKanban, setChecked, type KanbanBoard } from '../../shared/kanban'
import { normalizeName, pathsByName } from '../../shared/parse'
import { periodicNoteText } from '../../shared/periodic'
import { cardFolderFor, inRecto } from '../../shared/recto-paths'
import { normaliseFolder, type Period } from '../../shared/templates'
import { nameProblem } from '../../shared/vault'
import { dateArg, findBoard, periodicPlace } from './read'
import { folderOf, readNote, titleOf, ToolError, type Scope } from './scope'

/**
 * The write tools build proposals: the files a call would change, before and
 * after, with the person's formatting applied to the AI's lines. Nothing here
 * writes - main/vault-tools/proposals.ts applies or queues by the write mode.
 *
 * The hard rules are checked here, each with an error that says the rule:
 * unique names, links that resolve (or are declared new), the vault's link
 * form, periodic notes where the settings put them and from their template,
 * boards changed only through the board helpers, excluded folders left alone.
 */

type Args = Record<string, unknown>
export type Draft = { summary: string; files: FileChange[]; formatted: string[] }

const WIKI = /(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
const MD_NOTE = /(?<!!)\[[^\]\n]*\]\(([^()\s]+\.md)(?:#[^)\s]*)?\)/g

const count = (text: string, re: RegExp): Map<string, number> => {
  const out = new Map<string, number>()
  for (const m of text.matchAll(re)) {
    const key = m[1]!.trim().toLowerCase()
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/** Every link the AI added: it must resolve to one note, or be declared as a note that does not exist yet. */
function checkLinks(scope: Scope, before: string, after: string, newLinks: readonly string[]): void {
  const declared = new Set(
    newLinks.map((l) =>
      l
        .trim()
        .replace(/^\[\[|\]\]$/g, '')
        .toLowerCase(),
    ),
  )
  const old = count(before, WIKI)
  const byName = pathsByName(scope.allNotes)
  for (const [target, n] of count(after, WIKI)) {
    if (n <= (old.get(target) ?? 0)) continue
    if (declared.has(target)) {
      if (scope.resolve(target) === null) continue
    }
    const same = target.includes('/') ? [] : (byName.get(normalizeName(target)) ?? []).filter((p) => !scope.hidden(p))
    if (same.length > 1)
      throw new ToolError(
        `[[${target}]] is ambiguous: ${same.length} notes have that name (${same.join(', ')}). Write the shortest path that is unique: ${same.map((p) => `[[${scope.linkTo(p)}]]`).join(' or ')}.`,
      )
    if (scope.resolve(target) === null)
      throw new ToolError(
        `[[${target}]] links to no note in this vault. Link an existing note by its exact name (search_notes finds it), or list "${target}" in new_links if a note of that name is meant to be made later.`,
      )
  }
  if (scope.settings.formatting.linkForm === 'markdown') return
  const oldMd = count(before, MD_NOTE)
  for (const [target, n] of count(after, MD_NOTE))
    if (n > (oldMd.get(target) ?? 0))
      throw new ToolError(
        `Links to notes are written [[Note name]] in this vault, not [text](${target}). Use [[${titleOf(target)}]] (or [[Note name|text]] for other words).`,
      )
}

const formatCtx = (scope: Scope, p: string): FormatContext => ({
  name: titleOf(p),
  links: {
    toWiki: (target) => {
      const found = scope.resolve(target)
      return found === null ? null : scope.linkTo(found)
    },
    toPath: (target) => scope.resolve(target),
  },
})

/** A note's proposed text, the hard rules checked and the AI's lines formatted. */
function noteChange(
  scope: Scope,
  p: string,
  before: string | null,
  after: string,
  newLinks: readonly string[],
): { change: FileChange; formatted: string[] } {
  checkLinks(scope, before ?? '', after, newLinks)
  const result = formatChanged(before, after, scope.settings.formatting, formatCtx(scope, p))
  return { change: { path: p, before, after: result.text }, formatted: result.applied }
}

const links = (a: Args): string[] => (Array.isArray(a['new_links']) ? (a['new_links'] as string[]) : [])

/** A note the AI may change: visible, and not a board. */
async function editable(scope: Scope, target: string): Promise<{ path: string; text: string }> {
  const p = scope.need(target)
  const text = await readNote(p)
  if (isKanban(text))
    throw new ToolError(
      `“${titleOf(p)}” is a board. Boards change through propose_task and propose_task_update only, so their format stays intact.`,
    )
  return { path: p, text }
}

/** A new note's name: allowed, and not taken anywhere in the vault. */
function freeName(scope: Scope, name: string): void {
  const problem = nameProblem(name, true)
  if (problem !== null) throw new ToolError(`${problem}. Choose another name.`)
  const taken = scope.allNotes.find((p) => titleOf(p).toLowerCase() === name.toLowerCase())
  if (taken !== undefined) {
    const where = scope.hidden(taken) ? 'this vault' : folderOf(taken) === '' ? 'the top of the vault' : `${folderOf(taken)}/`
    throw new ToolError(
      `A note “${titleOf(taken)}” already exists in ${where}. Note names are unique in the whole vault: use propose_edit or propose_append to change it, or choose another name.`,
    )
  }
}

export function proposeNewNote(scope: Scope, a: Args): Draft {
  const name = String(a['name']).trim().replace(/\.md$/i, '')
  freeName(scope, name)
  const typed = String(a['folder'] ?? '').trim()
  const folder = typed.replace(/^\/+|\/+$/g, '') === '' ? '' : normaliseFolder(typed)
  if (folder === null)
    throw new ToolError(`“${String(a['folder'])}” is not a folder Recto can use: no “..” and no folder starting with “.”.`)
  if (inRecto(folder)) throw new ToolError('Recto/ holds boards and their cards. Use propose_task to add a card.')
  const p = folder === '' ? `${name}.md` : `${folder}/${name}.md`
  if (scope.hidden(p)) throw new ToolError(`${folder}/ is excluded from AI in Recto's settings. Choose another folder.`)
  let text = String(a['text'])
  const props = a['properties'] as Record<string, string | number | boolean | string[]> | undefined
  for (const [key, value] of Object.entries(props ?? {})) text = setField(text, key, value)
  const { change, formatted } = noteChange(scope, p, null, text.endsWith('\n') ? text : `${text}\n`, links(a))
  return { summary: `New note ${p}`, files: [change], formatted }
}

export async function proposeEdit(scope: Scope, a: Args): Promise<Draft> {
  const note = await editable(scope, String(a['note']))
  let after = note.text
  for (const [i, c] of (a['changes'] as { find: string; replace: string }[]).entries()) {
    const at = after.indexOf(c.find)
    if (at === -1) throw new ToolError(`Change ${i + 1}: its find text is not in “${titleOf(note.path)}”. Copy it exactly from read_note.`)
    if (after.indexOf(c.find, at + 1) !== -1)
      throw new ToolError(
        `Change ${i + 1}: its find text is in “${titleOf(note.path)}” more than once. Make it longer, so it matches one place.`,
      )
    after = after.slice(0, at) + c.replace + after.slice(at + c.find.length)
  }
  const { change, formatted } = noteChange(scope, note.path, note.text, after, links(a))
  return { summary: `Edit ${note.path}`, files: [change], formatted }
}

/** `text` added at the end of the section under `heading` (or of the note), on lines of its own. */
function appendTo(note: string, text: string, heading: string | undefined, name: string): string {
  const lines = note.replace(/\n+$/, '').split('\n')
  let at = lines.length
  if (heading !== undefined) {
    const want = heading
      .replace(/^#+\s*/, '')
      .trim()
      .toLowerCase()
    const start = lines.findIndex(
      (l) =>
        /^#{1,6}\s/.test(l) &&
        l
          .replace(/^#+\s*/, '')
          .trim()
          .toLowerCase() === want,
    )
    if (start === -1) {
      const heads = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim())
      throw new ToolError(`“${name}” has no heading “${heading}”. Its headings: ${heads.join(', ') || 'none'}.`)
    }
    const depth = /^#+/.exec(lines[start]!)![0].length
    const next = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= depth)
    at = next === -1 ? lines.length : next
    while (at > start + 1 && lines[at - 1]!.trim() === '') at--
  }
  const added = text.replace(/^\n+|\n+$/g, '').split('\n')
  // A blank line between the note's last block and the new text, so a paragraph is not glued onto it;
  // only between two list items is none needed. The formatting profile may still take it away.
  const before = lines[at - 1]
  const list = /^\s*(?:[-*+]|\d+[.)])\s/
  if (before !== undefined && before.trim() !== '' && !(list.test(before) && list.test(added[0] ?? ''))) added.unshift('')
  return `${[...lines.slice(0, at), ...added, ...lines.slice(at)].join('\n')}\n`
}

/** A periodic note's path and text now: the file, or what its template makes when there is none yet. */
async function periodicNote(scope: Scope, period: Period, date: Date): Promise<{ path: string; before: string | null; base: string }> {
  const place = periodicPlace(scope, period, date)
  if (fs.existsSync(path.join(scope.vault, place.path))) {
    const text = await readNote(place.path)
    return { path: place.path, before: text, base: text }
  }
  const chosen = scope.templates.periodic[period].template
  const template = chosen === null ? null : await readNote(chosen).catch(() => null)
  return { path: place.path, before: null, base: periodicNoteText(period, scope.templates.periodic, date, template) }
}

export async function proposeAppend(scope: Scope, a: Args): Promise<Draft> {
  const periodic = a['periodic'] as { period: Period; date?: string } | undefined
  if ((periodic === undefined) === (a['note'] === undefined)) throw new ToolError('Give either note or periodic, not both.')
  const heading = typeof a['under_heading'] === 'string' ? a['under_heading'] : undefined
  if (periodic !== undefined) {
    const note = await periodicNote(scope, periodic.period, dateArg(periodic.date))
    const after = appendTo(note.base, String(a['text']), heading, titleOf(note.path))
    // The template's own lines are the person's, not the AI's: only the appended text is formatted.
    const { change, formatted } = noteChange(scope, note.path, note.base, after, links(a))
    return {
      summary: `Append to ${titleOf(note.path)}${note.before === null ? ' (made from its template)' : ''}`,
      files: [{ ...change, before: note.before }],
      formatted,
    }
  }
  const note = await editable(scope, String(a['note']))
  const { change, formatted } = noteChange(
    scope,
    note.path,
    note.text,
    appendTo(note.text, String(a['text']), heading, titleOf(note.path)),
    links(a),
  )
  return { summary: `Append to ${note.path}`, files: [change], formatted }
}

export async function proposeLink(scope: Scope, a: Args): Promise<Draft> {
  const from = await editable(scope, String(a['from']))
  const to = scope.need(String(a['to']))
  const link = `[[${scope.linkTo(to).replace(/\.md$/i, '')}]]`
  let after: string
  if (typeof a['after_text'] === 'string') {
    const find = a['after_text']
    const at = from.text.indexOf(find)
    if (at === -1 || from.text.indexOf(find, at + 1) !== -1)
      throw new ToolError(
        `after_text must match exactly one place in “${titleOf(from.path)}”${at === -1 ? '; it matches none' : '; it matches more than one'}.`,
      )
    after = `${from.text.slice(0, at + find.length)} ${link}${from.text.slice(at + find.length)}`
  } else after = appendTo(from.text, link, undefined, titleOf(from.path))
  const { change, formatted } = noteChange(scope, from.path, from.text, after, [])
  return { summary: `Link ${titleOf(from.path)} → ${titleOf(to)}`, files: [change], formatted }
}

const laneIndex = (board: KanbanBoard, title: unknown): number => {
  if (title === undefined) return 0
  const i = board.lanes.findIndex((l) => l.title.toLowerCase() === String(title).trim().toLowerCase())
  if (i === -1) throw new ToolError(`No lane “${String(title)}”. Lanes: ${board.lanes.map((l) => l.title).join(', ')}.`)
  return i
}

export async function proposeTask(scope: Scope, a: Args): Promise<Draft> {
  const title = String(a['title']).trim()
  if (a['note'] !== undefined) {
    if (a['board'] !== undefined) throw new ToolError('Give either board (a card) or note (a "- [ ]" line), not both.')
    const note = await editable(scope, String(a['note']))
    const heading = typeof a['under_heading'] === 'string' ? a['under_heading'] : undefined
    const { change, formatted } = noteChange(
      scope,
      note.path,
      note.text,
      appendTo(note.text, `- [ ] ${title}`, heading, titleOf(note.path)),
      [],
    )
    return { summary: `Task in ${titleOf(note.path)}`, files: [change], formatted }
  }
  if (a['board'] === undefined) throw new ToolError('Give board (a card on a board, see list_boards) or note (a "- [ ]" line in a note).')
  const board = await findBoard(scope, String(a['board']))
  const parsed = parseKanban(board.text)
  if (parsed.lanes.length === 0) throw new ToolError(`“${titleOf(board.path)}” has no lanes yet.`)
  const lane = laneIndex(parsed, a['lane'])
  const asNote = a['as_note'] === true || a['due'] !== undefined || a['priority'] !== undefined
  if (!asNote) {
    if (title.includes('\n')) throw new ToolError('A card’s title is one line.')
    return {
      summary: `Card “${title}” on ${titleOf(board.path)}`,
      files: [{ path: board.path, before: board.text, after: insertItem(board.text, lane, 0, title) }],
      formatted: [],
    }
  }
  // A card that is a note: the note in the board's folder, and its [[link]] on the board.
  freeName(scope, title)
  const folder = cardFolderFor(board.path, board.text)
  const p = `${folder}/${title}.md`
  let text = ''
  if (typeof a['due'] === 'string') text = setCardField(text, 'due', a['due'])
  if (typeof a['priority'] === 'string') text = setCardField(text, 'priority', a['priority'])
  return {
    summary: `Card “${title}” on ${titleOf(board.path)}`,
    files: [
      { path: p, before: null, after: text },
      { path: board.path, before: board.text, after: insertItem(board.text, lane, 0, cardLink(scope.linkTo(p).replace(/\.md$/i, ''))) },
    ],
    formatted: [],
  }
}

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function proposeTaskUpdate(scope: Scope, a: Args): Promise<Draft> {
  if (a['note'] !== undefined) {
    if (typeof a['line'] !== 'number' || typeof a['done'] !== 'boolean')
      throw new ToolError('For a task in a note, give note, line (1-based) and done.')
    const note = await editable(scope, String(a['note']))
    const lines = note.text.split('\n')
    const line = lines[a['line'] - 1]
    if (line === undefined || !/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line))
      throw new ToolError(`Line ${a['line']} of “${titleOf(note.path)}” is not a "- [ ]" task. Read the note to find its line.`)
    lines[a['line'] - 1] = line.replace(/\[[ xX]\]/, a['done'] ? '[x]' : '[ ]')
    return {
      summary: `${a['done'] ? 'Tick' : 'Untick'} a task in ${titleOf(note.path)}`,
      files: [{ path: note.path, before: note.text, after: lines.join('\n') }],
      formatted: [],
    }
  }
  if (a['board'] === undefined || a['card'] === undefined)
    throw new ToolError('Give board and card (a card on a board), or note and line (a task in a note).')
  const board = await findBoard(scope, String(a['board']))
  let text = board.text
  const parsed = parseKanban(text)
  const want = String(a['card']).trim().toLowerCase()
  const found: { lane: number; index: number }[] = []
  parsed.lanes.forEach((lane, l) =>
    lane.items.forEach((item, i) => {
      if (
        item.text.trim().toLowerCase() === want ||
        (item.link !== null && (item.link.toLowerCase() === want || titleOf(item.link).toLowerCase() === want))
      )
        found.push({ lane: l, index: i })
    }),
  )
  if (found.length !== 1)
    throw new ToolError(
      found.length === 0
        ? `No card “${String(a['card'])}” on ${titleOf(board.path)}. read_board lists its cards.`
        : `${found.length} cards on ${titleOf(board.path)} match “${String(a['card'])}”.`,
    )
  const ref = found[0]!
  const item = parsed.lanes[ref.lane]!.items[ref.index]!
  const done = doneLane(parsed.lanes)
  let target = a['lane'] === undefined ? ref.lane : laneIndex(parsed, a['lane'])
  if (a['done'] === true && a['lane'] === undefined && done !== -1) target = done
  const checked = a['done'] === undefined ? (target === done ? true : item.checked) : a['done'] === true
  if (target !== ref.lane) text = moveItem(text, ref, { lane: target, index: 0 }, checked)
  else if (checked !== item.checked) text = setChecked(text, ref, checked)
  const files: FileChange[] = text === board.text ? [] : [{ path: board.path, before: board.text, after: text }]

  const fields: [string, string | null][] = []
  if (a['due'] !== undefined) fields.push(['due', a['due'] as string | null])
  if (a['priority'] !== undefined) fields.push(['priority', a['priority'] as string | null])
  if (checked !== item.checked) fields.push(['completed', checked ? today() : null])
  const cardNote = item.link === null ? null : scope.resolve(item.link)
  if (fields.some(([k]) => k !== 'completed') && cardNote === null)
    throw new ToolError('Due dates and priorities belong to a card that is a note; this card is plain text.')
  if (cardNote !== null && fields.length > 0) {
    const before = await readNote(cardNote)
    let after = before
    for (const [key, value] of fields) after = setCardField(after, key, value)
    if (after !== before) files.push({ path: cardNote, before, after })
  }
  if (files.length === 0) throw new ToolError('That changes nothing: the card is already like that.')
  return { summary: `Update “${titleOf(item.link ?? item.text)}” on ${titleOf(board.path)}`, files, formatted: [] }
}
