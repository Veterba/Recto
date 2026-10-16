import { commands, type CommandScope } from './commands'
import { formatChord, normalizeChord, RESERVED, type Chord } from './hotkeys'

/**
 * Every command and its binding, grouped: what Settings → Shortcuts lists and
 * what the ⌘/ cheat sheet shows - one source, so the two can never disagree.
 */

/** The order groups appear in; any other section comes after, alphabetically. */
export const SECTION_ORDER = [
  'Editor',
  'Formatting',
  'Tables',
  'Navigation',
  'Panes',
  'Vault',
  'Periodic notes',
  'Tasks',
  'Bots',
  'Writing',
  'Appearance',
  'App',
] as const

export type HotkeyRow = {
  id: string
  name: string
  section: string
  scope: CommandScope
  /** The binding in force, as written ('Mod+Shift+D'), or null. */
  binding: string | null
  /** As shown: ⌘⇧D. */
  label: string | null
}

export type HotkeyGroup = { section: string; rows: HotkeyRow[] }

export function hotkeyRows(): HotkeyRow[] {
  return commands.list().map((command) => {
    const binding = commands.bindingFor(command.id)
    return {
      id: command.id,
      name: command.name,
      section: command.section ?? 'Other',
      scope: command.scope ?? 'app',
      binding,
      label: binding === null ? null : formatChord(binding),
    }
  })
}

const rank = (section: string): number => {
  const i = (SECTION_ORDER as readonly string[]).indexOf(section)
  return i === -1 ? SECTION_ORDER.length : i
}

/** Rows grouped by section, in SECTION_ORDER, names sorted within a group. */
export function groupRows(rows: readonly HotkeyRow[]): HotkeyGroup[] {
  const groups = new Map<string, HotkeyRow[]>()
  for (const row of rows) groups.set(row.section, [...(groups.get(row.section) ?? []), row])
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([section, list]) => ({ section, rows: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
}

/** Does a row match a search: its name, its group, or its shortcut ("⌘⇧D", "shift d")? */
export function rowMatches(row: HotkeyRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const words = q.split(/\s+/)
  const hay = `${row.name} ${row.section} ${row.label ?? ''} ${row.binding ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * What stands in the way of binding `binding` to command `id`: a chord macOS
 * keeps, or other commands in the same scope that already use it. (The same
 * chord in another scope is fine - ⌘B is bold in a note and the sidebar
 * elsewhere.)
 */
export function bindingProblem(id: string, binding: string): { reserved: string } | { taken: string[] } | null {
  const chord: Chord = normalizeChord(binding)
  const reserved = RESERVED[chord]
  if (reserved !== undefined) return { reserved }
  const scope = commands.get(id)?.scope ?? 'app'
  const taken = commands.usersOf(chord, scope).filter((other) => other !== id)
  return taken.length > 0 ? { taken } : null
}
