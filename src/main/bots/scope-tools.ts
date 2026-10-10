import type { CatalogNote } from '../../shared/indexer-protocol'
import { isDaily } from '../../shared/tasks'
import type { NoteCard } from './cards'
import { nameSimilarity, type Scope } from './resolve'

/**
 * The tools for questions about many notes at once - "improve my math
 * notes", "what would you change in my vault", "suggest templates". Each
 * turns the index, the notes and their cards into a compact text the model
 * reads; nothing here asks the model anything (read_scope's map-reduce is in
 * tools.ts, which has the model).
 *
 * Pure: notes, their text and their cards are passed in.
 */

export type ScopeNote = CatalogNote & { content: string }

const folderOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const bodyOf = (content: string): string => content.replace(/^---\n[\s\S]*?\n---\n?/, '')
const wordCount = (text: string): number => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
/** The words a note's author wrote: no template scaffolding, no headings, no empty items. */
const ownWords = (content: string): number =>
  wordCount(
    bodyOf(content)
      .split('\n')
      .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*[-*]\s*(\[[ xX]?\]\s*)?(empty)?\s*$/i.test(l))
      .join('\n'),
  )

/** The notes a scope covers. A topic is matched in the topics property; the vault is everything. */
export function notesInScope<T extends CatalogNote>(scope: Scope, notes: readonly T[]): T[] {
  if (scope.kind === 'vault') return [...notes]
  if (scope.kind === 'folder') {
    const f = scope.folder.toLowerCase()
    return notes.filter((n) => n.path.toLowerCase().startsWith(`${f}/`))
  }
  const t = scope.topic.toLowerCase()
  return notes.filter((n) => (n.topics ?? '').toLowerCase().includes(t))
}

/** Where a project's note was found, surest first. */
export type ProjectTier = 'topic' | 'project' | 'folder' | 'linking'

/**
 * The notes of a project, for "tasks for my Recto app": first the notes the
 * topics property puts in it (`[[topics/Recto]]`), then those whose `project:`
 * property names it, then the scope's own notes (its folder, or its topic)
 * and the notes that link to any of them. A daily is never in by a link - its
 * items are about many things - so a daily's item comes in only as a guess,
 * shown apart. The project's names: the scope's label and every topic named
 * by one of its words ("Recto" for the folder "Recto app").
 */
export function projectNotes(scope: Scope, notes: readonly CatalogNote[], topics: readonly string[]): Map<string, ProjectTier> {
  const out = new Map<string, ProjectTier>()
  if (scope.kind === 'vault') return out
  const label = (scope.kind === 'folder' ? scope.folder.slice(scope.folder.lastIndexOf('/') + 1) : scope.topic).toLowerCase()
  const words = new Set(label.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))
  const names = new Set([
    label,
    ...topics.map((t) => t.toLowerCase()).filter((t) => t === label || words.has(t) || t.split(/\s+/).includes(label)),
  ])
  const add = (path: string, tier: ProjectTier): void => {
    if (!out.has(path)) out.set(path, tier)
  }
  for (const n of notes) {
    const own = (n.topics ?? '').toLowerCase()
    if ([...names].some((t) => new RegExp(`topics/${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\]|"]|$)`).test(own)))
      add(n.path, 'topic')
  }
  for (const n of notes) {
    const project = (n.project ?? '').toLowerCase().replace(/\[\[|\]\]|["']/g, '')
    // `project: Recto` is the folder "Recto app" too.
    const named = (p: string): boolean => names.has(p) || (p.length >= 4 && words.has(p))
    if (project.split(/[,|/]/).some((p) => named(p.trim()))) add(n.path, 'project')
  }
  for (const n of notesInScope(scope, notes)) add(n.path, 'folder')
  const core = new Set(out.keys())
  for (const n of notes) if (!isDaily(n.path) && (n.linksTo ?? []).some((p) => core.has(p))) add(n.path, 'linking')
  return out
}

/**
 * vault_map: the vault's shape - folders with their note counts and kinds,
 * stubs, orphans, look-alike titles, how notes are named, the templates,
 * how densely notes link. For "what would you change in my vault".
 */
export function vaultMap(notes: readonly ScopeNote[], cards: ReadonlyMap<string, NoteCard>, templateFolder = 'Template'): string {
  const lines: string[] = []
  const folders = new Map<string, ScopeNote[]>()
  for (const n of notes) {
    const f = folderOf(n.path)
    folders.set(f, [...(folders.get(f) ?? []), n])
  }
  lines.push(`## Vault map: ${notes.length} notes in ${[...folders.keys()].filter((f) => f !== '').length} folders`, '', '### Folders')
  // Every folder level, with the notes under it in all.
  const levels = new Map<string, number>()
  for (const n of notes) {
    const parts = folderOf(n.path).split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) levels.set(parts.slice(0, i).join('/'), (levels.get(parts.slice(0, i).join('/')) ?? 0) + 1)
  }
  const kindsIn = (folder: string): string => {
    const counts = new Map<string, number>()
    for (const n of notes.filter((x) => x.path.startsWith(`${folder}/`))) {
      const k = cards.get(n.path)?.kind ?? (isDaily(n.path) ? 'daily' : null)
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts].map(([k, c]) => `${k} ${c}`).join(', ')
  }
  for (const [folder, count] of [...levels].sort((a, b) => a[0].localeCompare(b[0]))) {
    const depth = folder.split('/').length - 1
    // Date folders (Daily/2026/09/W39) are summed up at their first level.
    if (/^\d{2,4}$|^W\d+$/i.test(folder.slice(folder.lastIndexOf('/') + 1))) continue
    const kinds = kindsIn(folder)
    lines.push(`${'  '.repeat(depth)}- ${folder.slice(folder.lastIndexOf('/') + 1)}/ — ${count} notes${kinds === '' ? '' : ` (${kinds})`}`)
  }
  const root = folders.get('') ?? []
  if (root.length > 0) lines.push(`- (vault root) — ${root.length}: ${root.map((n) => n.title).join(', ')}`)

  const stubs = notes.filter((n) => !isDaily(n.path) && ownWords(n.content) < 15)
  lines.push(
    '',
    `### Empty or nearly empty notes (${stubs.length})`,
    stubs.map((n) => `${n.title} (${folderOf(n.path) || 'root'})`).join('; ') || 'none',
  )
  const emptyDailies = notes.filter((n) => isDaily(n.path) && ownWords(n.content) < 5)
  if (emptyDailies.length > 0)
    lines.push(`Daily notes left as the empty template: ${emptyDailies.length} of ${notes.filter((n) => isDaily(n.path)).length}`)

  const orphans = notes.filter((n) => !isDaily(n.path) && n.linksIn === 0 && n.linksOut === 0)
  lines.push(
    '',
    `### Notes with no links in or out (${orphans.length} of ${notes.length})`,
    orphans.map((n) => n.title).join('; ') || 'none',
  )

  const looks: string[] = []
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i]!.title
      const b = notes[j]!.title
      // "Unit 4" and "Unit 5" are a series, not a duplicate.
      const series = a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#')
      if (a !== b && !series && !/^\d{4}-/.test(a) && nameSimilarity(a, b) >= 0.8) looks.push(`"${a}" ~ "${b}"`)
    }
  if (looks.length > 0) lines.push('', '### Look-alike titles', looks.join('; '))

  const dated = notes.filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n.title)).length
  const numbered = notes.filter((n) => /^\d+[ .\-_]/.test(n.title) && !/^\d{4}-\d{2}/.test(n.title)).length
  const lower = notes.filter((n) => /^\p{Ll}/u.test(n.title))
  const cyrillic = notes.filter((n) => /\p{Script=Cyrillic}/u.test(n.title)).length
  const firstLine = notes.filter((n) => /^\s*[*_]note (about|on|with)/i.test(bodyOf(n.content).trimStart())).length
  lines.push(
    '',
    '### Naming',
    `- dated titles (YYYY-MM-DD…): ${dated}; numbered titles ("0 …"): ${numbered}; titles in Cyrillic: ${cyrillic}`,
    `- titles starting lowercase: ${lower.length}${
      lower.length > 0
        ? ` (${lower
            .map((n) => n.title)
            .slice(0, 8)
            .join(', ')})`
        : ''
    }`,
    `- notes opening with an italic "*Note about …*" line: ${firstLine} of ${notes.filter((n) => !isDaily(n.path)).length} non-daily notes`,
  )

  const templates = notes.filter((n) => n.path.toLowerCase().startsWith(`${templateFolder.toLowerCase()}/`))
  lines.push(
    '',
    `### Templates (${templateFolder}/)`,
    templates.length === 0
      ? 'none'
      : templates.map((n) => `- ${n.title}: ${n.headings.map((h) => h.text).join(' / ') || 'no headings'}`).join('\n'),
  )

  // What stands out, first: a small model reads the top of a long text best.
  const catchAll = [...folders].filter(
    ([f, ns]) => /^(other|misc|inbox|notes|random|разное|прочее)$/i.test(f.slice(f.lastIndexOf('/') + 1)) && ns.length >= 3,
  )
  const stands = [
    root.length > 0 ? `${root.length} note(s) at the vault root, outside any folder: ${root.map((n) => `"${n.title}"`).join(', ')}` : null,
    ...catchAll.map(
      ([f, ns]) => `"${f}/" is a catch-all folder with ${ns.length} notes on different subjects: ${ns.map((n) => n.title).join(', ')}`,
    ),
    stubs.length > 0 ? `${stubs.length} empty or nearly empty notes` : null,
    emptyDailies.length > 0 ? `${emptyDailies.length} daily notes left as the empty template` : null,
    orphans.length > 0 ? `${orphans.length} notes with no links in or out` : null,
    looks.length > 0 ? `look-alike titles: ${looks.join('; ')}` : null,
    lower.length > 0 ? `${lower.length} titles start with a lowercase letter` : null,
  ].filter((x): x is string => x !== null)
  lines.splice(1, 0, '', '### What stands out', ...stands.map((x) => `- ${x}`))

  const links = notes.reduce((s, n) => s + n.linksOut, 0)
  const topics = new Map<string, number>()
  for (const n of notes) for (const m of (n.topics ?? '').matchAll(/topics\/([^\]"]+)/g)) topics.set(m[1]!, (topics.get(m[1]!) ?? 0) + 1)
  lines.push(
    '',
    '### Links',
    `${links} links between notes, ${(links / Math.max(1, notes.length)).toFixed(1)} per note; ${notes.filter((n) => n.linksOut === 0).length} notes link nowhere.`,
    topics.size === 0 ? 'No topics.' : `Topics: ${[...topics].map(([t, c]) => `${t} (${c})`).join(', ')}`,
  )
  return lines.join('\n')
}

/** A note's heading skeleton: its headings and the bold lines that stand for headings, in order. */
export function skeleton(content: string): string[] {
  const out: string[] = []
  let fence = false
  for (const line of bodyOf(content).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s*\*\*([^*\n]{1,60}?)\*\*\s*:?\s*$/.exec(line)
    if (h !== null) out.push(h[1]!.trim())
  }
  return out
}

/**
 * note_outline: one note's structure - its heading tree with the size of
 * each section, the empty ones, its links and properties, its first line.
 * For "improve the structure of this note".
 */
export function noteOutline(note: ScopeNote): string {
  const lines = [`## Outline of "${note.title}" (${note.path})`]
  const props = /^---\n([\s\S]*?)\n---/.exec(note.content)?.[1]
  lines.push(
    `Properties: ${
      props === undefined
        ? 'none'
        : props
            .split('\n')
            .filter((l) => /^\w/.test(l))
            .map((l) => l.split(':')[0])
            .join(', ')
    }`,
  )
  const body = bodyOf(note.content)
  const first =
    body
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  lines.push(`First line: ${first.slice(0, 160) || '(empty)'}`)
  lines.push(`Size: ${wordCount(body)} words; links out ${note.linksOut}, links in ${note.linksIn}`)
  lines.push('Sections (heading — words):')
  let current = '(before the first heading)'
  let depth = 0
  let count = 0
  const flush = (): void => {
    if (current === '(before the first heading)' && count === 0) return
    lines.push(`${'  '.repeat(depth)}- ${current} — ${count === 0 ? 'EMPTY' : count}`)
  }
  let fence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    const b = fence || h !== null ? null : /^\s*\*\*([^*\n]{1,60}?)\*\*\s*:?\s*$/.exec(line)
    if (h !== null || b !== null) {
      flush()
      current = h !== null ? h[2]!.trim() : `**${b![1]!.trim()}** (bold line)`
      depth = h !== null ? h[1]!.length - 1 : 3
      count = 0
      continue
    }
    count += wordCount(line)
  }
  flush()
  return lines.join('\n')
}

/**
 * structure_patterns: notes that share a heading skeleton (dailies with
 * Tasks / Notes / What I learned), how notes open, which properties travel
 * together - with counts and an example. The base for "suggest templates".
 */
export function structurePatterns(notes: readonly ScopeNote[]): string {
  const lines = ['## Structure patterns in the vault']
  const groups = new Map<string, ScopeNote[]>()
  for (const n of notes) {
    const s = skeleton(n.content).map((h) => h.toLowerCase())
    if (s.length < 2) continue
    const key = s.join(' / ')
    groups.set(key, [...(groups.get(key) ?? []), n])
  }
  const shared = [...groups].filter(([, g]) => g.length >= 2).sort((a, b) => b[1].length - a[1].length)
  lines.push('', '### Same headings')
  if (shared.length === 0) lines.push('No two notes share their headings.')
  for (const [key, g] of shared.slice(0, 8))
    lines.push(`- ${g.length} notes: ${key} — e.g. ${g[0]!.title} (${folderOf(g[0]!.path) || 'root'})`)

  // Headings that come back across notes, whatever the rest of the note is.
  const counts = new Map<string, number>()
  for (const n of notes) for (const h of new Set(skeleton(n.content).map((x) => x.toLowerCase()))) counts.set(h, (counts.get(h) ?? 0) + 1)
  const common = [...counts].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1])
  if (common.length > 0)
    lines.push(
      '',
      '### Headings used in 3 or more notes',
      common
        .slice(0, 15)
        .map(([h, c]) => `${h} (${c})`)
        .join('; '),
    )

  const openers = new Map<string, ScopeNote[]>()
  for (const n of notes) {
    const first =
      bodyOf(n.content)
        .split('\n')
        .find((l) => l.trim() !== '')
        ?.trim() ?? ''
    const shape = /^[*_]note (about|on|with)\b/i.test(first)
      ? 'an italic "*Note about …*" line'
      : /^\*\*[^*]+\*\*/.test(first)
        ? 'a bold line'
        : /^#\s/.test(first)
          ? 'a title heading'
          : /^##\s/.test(first)
            ? 'a section heading'
            : null
    if (shape !== null) openers.set(shape, [...(openers.get(shape) ?? []), n])
  }
  lines.push('', '### How notes open')
  for (const [shape, g] of [...openers].sort((a, b) => b[1].length - a[1].length))
    lines.push(
      `- ${g.length} open with ${shape} — e.g. ${g
        .slice(0, 3)
        .map((n) => n.title)
        .join(', ')}`,
    )

  const props = new Map<string, ScopeNote[]>()
  for (const n of notes) {
    const keys = (/^---\n([\s\S]*?)\n---/.exec(n.content)?.[1] ?? '')
      .split('\n')
      .filter((l) => /^[\w-]+:/.test(l))
      .map((l) => l.split(':')[0]!)
      .sort()
    if (keys.length > 0) props.set(keys.join(', '), [...(props.get(keys.join(', ')) ?? []), n])
  }
  lines.push('', '### Properties that travel together')
  for (const [keys, g] of [...props].sort((a, b) => b[1].length - a[1].length).slice(0, 6))
    lines.push(`- ${g.length} notes: ${keys} — e.g. ${g[0]!.title}`)
  return lines.join('\n')
}

/** A note as a card line for read_scope: title, folder, summary, headings. */
export const cardLine = (n: ScopeNote, card: NoteCard | undefined): string =>
  `- **${n.title}** (${folderOf(n.path) || 'root'}, ${wordCount(bodyOf(n.content))} words${card === undefined ? '' : `, ${card.kind}`}): ${
    card?.summary ?? (bodyOf(n.content).trim().slice(0, 200).replace(/\s+/g, ' ') || 'empty')
  }${(card?.headings.length ?? 0) > 0 ? ` Headings: ${card!.headings.join(' / ')}.` : ''}`

/** Small enough to give the model whole: at most this many notes, within the budget. */
export const SMALL_SCOPE = 6

/** The notes of a small scope, whole (frontmatter dropped), or null when they don't fit. */
export function wholeNotes(notes: readonly ScopeNote[], budget: number): string | null {
  if (notes.length > SMALL_SCOPE) return null
  const parts = notes.map((n) => `### ${n.title} (${n.path})\n${bodyOf(n.content).trim()}`)
  const size = parts.reduce((s, p) => s + p.length, 0)
  return size <= budget ? parts.join('\n\n') : null
}
