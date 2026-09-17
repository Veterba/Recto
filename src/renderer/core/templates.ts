/**
 * Templates: notes you insert into other notes.
 *
 * A template IS a note, in a folder, exactly like a task card is a note. There
 * is no template format and no template store - which means you write one by
 * writing a note, you edit one in the ordinary editor, and `git log` is its
 * history. The only thing this module adds is the substitution of a handful of
 * `{{placeholders}}` at insert time.
 *
 * Deliberately a tiny vocabulary. A template language is a programming language
 * eventually, and the moment it has conditionals nobody can read the template
 * as a note any more.
 */

import { parseFrontmatter, setField } from './frontmatter'

/** Where templates live when the vault has not said otherwise. */
export const TEMPLATE_FOLDER = 'templates'

/** Where daily notes go when the vault has not said otherwise. */
export const DAILY_FOLDER = 'Daily'

/**
 * Per-vault template settings, in `.recto/templates.json`.
 *
 * Per vault, not per install: a work vault and a journal vault want different
 * templates folders and only one of them wants a daily note.
 */
export type TemplateSettings = {
  /** Vault-relative folder holding the templates. */
  folder: string
  daily: {
    enabled: boolean
    /** Vault-relative folder the year folders go under. */
    folder: string
    /** Vault-relative path of the template to use, or null for the built-in one. */
    template: string | null
  }
}

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  folder: TEMPLATE_FOLDER,
  daily: { enabled: false, folder: DAILY_FOLDER, template: null },
}

/**
 * A folder path as typed, made into one the vault can use - or null.
 *
 * Trimmed, slashes collapsed, leading and trailing slashes dropped. Refused
 * outright: `..` anywhere, and any segment starting with a dot, because those
 * are the app's own state folder and the file tree hides them - a templates
 * folder there would be a folder you set and then could never see.
 *
 * Main re-checks containment on every write regardless; this is so the
 * settings field says "no" instead of silently doing something else.
 */
export function normaliseFolder(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (cleaned === '') return null
  const segments = cleaned.split('/')
  if (segments.some((segment) => segment === '' || segment === '..' || segment.startsWith('.'))) return null
  return segments.map((segment) => segment.trim()).join('/')
}

/** Read the settings file back, falling back field by field rather than wholesale. */
export function coerceTemplateSettings(value: unknown): TemplateSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_TEMPLATE_SETTINGS
  const v = value as { folder?: unknown; daily?: unknown }
  const daily = (typeof v.daily === 'object' && v.daily !== null ? v.daily : {}) as {
    enabled?: unknown
    folder?: unknown
    template?: unknown
  }
  const folder = typeof v.folder === 'string' ? normaliseFolder(v.folder) : null
  const dailyFolder = typeof daily.folder === 'string' ? normaliseFolder(daily.folder) : null
  const template =
    typeof daily.template === 'string' && normaliseFolder(daily.template) !== null && /\.md$/i.test(daily.template)
      ? daily.template
      : null
  return {
    folder: folder ?? DEFAULT_TEMPLATE_SETTINGS.folder,
    daily: {
      enabled: daily.enabled === true,
      folder: dailyFolder ?? DEFAULT_TEMPLATE_SETTINGS.daily.folder,
      template,
    },
  }
}

/** Is this path inside (or exactly) that folder? Segment-wise, not by prefix. */
export function isInFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/**
 * ISO 8601 week number and the year that week belongs to.
 *
 * Weeks start on Monday, and week 1 is the one containing the year's first
 * Thursday. The second half matters: 29 December can be week 1 of the NEXT
 * year, and 1 January can be week 53 of the previous one. Getting that wrong
 * files a note under a week number that does not exist in that year.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Thursday of this week decides the year.
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/**
 * Where today's daily note goes: `Daily/2026/09/W37/2026-09-14.md`.
 *
 * Year, month, week, then the note. The note's own name carries the full date
 * rather than just `14`, because notes are linked by name - `[[14]]` would be
 * ambiguous across every month in the vault, `[[2026-09-14]]` never is.
 *
 * The week folder uses the ISO week number, and sits under the CALENDAR year
 * and month of the day itself. So 29 December 2025 lands in
 * `2025/12/W01` - its ISO week belongs to 2026, but a person looking for a
 * December note looks in December.
 */
export function dailyNotePath(date: Date, root: string): { folder: string; name: string; path: string; key: string } {
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const week = `W${pad(isoWeek(date).week)}`
  const key = isoDate(date)
  const folder = `${root}/${year}/${month}/${week}`
  const name = `${key}.md`
  return { folder, name, path: `${folder}/${name}`, key }
}

/** What a daily note contains when no template has been chosen. */
export const BUILT_IN_DAILY = '# {{date}}\n\n'

export type TemplateVars = {
  /** The note being written into, without its extension. */
  title: string
  /** The note's vault-relative path. */
  path: string
  /** For deterministic tests, and so every placeholder in one insert agrees. */
  now: Date
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** ISO date, because it sorts and because it is unambiguous internationally. */
const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const isoTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * `{{date}}`, `{{time}}`, `{{title}}`, `{{path}}`, and `{{date:+7}}` /
 * `{{date:-1}}` for a day offset - enough for a daily note, a meeting note and
 * a follow-up, which is what people actually write templates for.
 *
 * An unknown placeholder is left exactly as written rather than replaced with
 * an empty string: a silently vanished `{{attendees}}` looks like the template
 * was wrong, while the literal text shows you what to fix.
 */
export function fillTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-z]+)(?::([+-]?\d+))?\s*\}\}/gi, (whole, rawName: string, offset?: string) => {
    const name = rawName.toLowerCase()
    const shifted = new Date(vars.now)
    if (offset !== undefined) shifted.setDate(shifted.getDate() + Number(offset))

    switch (name) {
      case 'date':
        return isoDate(shifted)
      case 'time':
        return isoTime(vars.now)
      case 'title':
        return vars.title
      case 'path':
        return vars.path
      default:
        return whole
    }
  })
}

/**
 * Strip a template's own frontmatter before inserting it INTO an existing note.
 *
 * Only for that case: a new note made from a template keeps the frontmatter, so
 * the properties a template carries end up on the note it makes.
 *
 * A template is a note, so it may carry `title:` or `tags:` of its own from
 * being edited. Pasting that into the middle of another note would produce a
 * second `---` block halfway down the file, which is not frontmatter at all -
 * it is a horizontal rule and a pile of stray text.
 */
export function templateBody(text: string): string {
  const lines = text.split(/\r?\n/)
  if (!/^---\s*$/.test(lines[0] ?? '')) return text
  for (let i = 1; i < lines.length; i++) {
    if (!/^---\s*$/.test(lines[i] ?? '')) continue
    // Drop one blank line after the block, which is the one a writer would have
    // left between the frontmatter and the body.
    const rest = lines.slice(i + 1)
    if (rest[0]?.trim() === '') rest.shift()
    return rest.join('\n')
  }
  return text
}

/**
 * A template's own properties, for merging into the note it fills.
 *
 * Only the fields this editor understands: a nested map inside a template is
 * left where it is rather than half-copied. Fields already on the target note
 * win - the note's own `tags:` are not replaced by the template's.
 */
export function mergeTemplateProperties(target: string, template: string): string {
  const from = parseFrontmatter(template)
  if (!from.present || from.fields.length === 0) return target
  const existing = new Set(parseFrontmatter(target).fields.map((field) => field.key.toLowerCase()))
  let out = target
  for (const field of from.fields) {
    if (existing.has(field.key.toLowerCase())) continue
    out = setField(out, field.key, field.value)
  }
  return out
}

/** Display name for a template file. */
export const templateName = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
