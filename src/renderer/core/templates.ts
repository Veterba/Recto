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

export const TEMPLATE_FOLDER = 'templates'

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
 * Strip a template's own frontmatter before inserting it.
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

/** Display name for a template file. */
export const templateName = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
