/**
 * Note names and links, exactly as Obsidian has them - so a link means the
 * same file in Recto and in Obsidian. The rules, and where each was measured,
 * are in docs/dev/obsidian-link-rules.md; every rule here has a test.
 *
 * Several files may share a name. A link is read from the note it is in
 * (`resolveLinkpath`), and written for that note in the vault's chosen format
 * (`formatLink`).
 */

import { nextFence, type Fence } from './parse'

/** A file as the rules see it: its vault path, and when it was made (Obsidian's order among equals). */
export type LinkFile = { path: string; ctime: number }

/** Obsidian's "Files and links" settings that decide how a link is written, and whether renames update links. */
export type LinkSettings = {
  /** New link format. */
  newLinkFormat: 'shortest' | 'relative' | 'absolute'
  /** `[text](path.md)` instead of `[[path]]`. */
  useMarkdownLinks: boolean
  /** Rename a file: update the links to it without asking. Off: ask each time. */
  alwaysUpdateLinks: boolean
}

/** Obsidian's defaults, used when the vault has no `.obsidian/app.json` saying otherwise. */
export const OBSIDIAN_DEFAULTS: LinkSettings = { newLinkFormat: 'shortest', useMarkdownLinks: false, alwaysUpdateLinks: false }

/** The settings from Obsidian's `.obsidian/app.json` text, the defaults where it says nothing. Never written. */
export function settingsFromAppJson(text: string | null): LinkSettings {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = text === null ? {} : JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) raw = parsed as Record<string, unknown>
  } catch {
    raw = {}
  }
  const format = raw['newLinkFormat']
  return {
    newLinkFormat: format === 'relative' || format === 'absolute' || format === 'shortest' ? format : OBSIDIAN_DEFAULTS.newLinkFormat,
    useMarkdownLinks: typeof raw['useMarkdownLinks'] === 'boolean' ? raw['useMarkdownLinks'] : OBSIDIAN_DEFAULTS.useMarkdownLinks,
    alwaysUpdateLinks: typeof raw['alwaysUpdateLinks'] === 'boolean' ? raw['alwaysUpdateLinks'] : OBSIDIAN_DEFAULTS.alwaysUpdateLinks,
  }
}

const lower = (s: string): string => s.normalize('NFC').toLowerCase()
export const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const isNote = (path: string): boolean => /\.md$/i.test(path)
/** A file's name as a link shows it: a note's without `.md`, any other file's with its extension. */
export const linkName = (path: string): string => (isNote(path) ? fileName(path).slice(0, -3) : fileName(path))

/**
 * The vault, indexed for reading links: every file by its path, and by its
 * name, both ignoring case. Built once per change of the file list.
 */
export type LinkVault = {
  byPath: ReadonlyMap<string, LinkFile>
  byName: ReadonlyMap<string, readonly LinkFile[]>
}

export function linkVault(files: Iterable<LinkFile>): LinkVault {
  const byPath = new Map<string, LinkFile>()
  const byName = new Map<string, LinkFile[]>()
  for (const f of files) {
    byPath.set(lower(f.path), f)
    // By the file's whole name (`plan.md`, `image.png`), and a note also by its name without `.md`.
    for (const key of isNote(f.path) ? [lower(fileName(f.path)), lower(linkName(f.path))] : [lower(fileName(f.path))]) {
      const list = byName.get(key)
      if (list === undefined) byName.set(key, [f])
      else list.push(f)
    }
  }
  return { byPath, byName }
}

/** A link's target split into the path and its subpath (`#Heading`, `#^block`), as Obsidian splits it. */
export function splitSubpath(target: string): { path: string; subpath: string } {
  const at = target.indexOf('#')
  return at === -1 ? { path: target, subpath: '' } : { path: target.slice(0, at), subpath: target.slice(at) }
}

/** `a/./b/../c` made plain; `..` above the vault's top stays at the top, as in Obsidian. */
function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** The file at this exact vault path, ignoring case, `.md` optional. */
function exact(vault: LinkVault, path: string): LinkFile | null {
  const key = lower(path)
  return vault.byPath.get(key) ?? vault.byPath.get(`${key}.md`) ?? null
}

/**
 * The file a link means, read from the note it is in - Obsidian's order:
 *
 * 1. `/x`: a path from the vault's top.
 * 2. `./x`, `../x`: relative to the note's folder; there, or nowhere.
 * 3. An exact vault path, ignoring case, `.md` optional.
 * 4. The files whose path ends with `/x`: those in the note's folder or below
 *    it first, then the shorter path (in characters), then the one made first.
 *
 * `linkpath` has no subpath (see splitSubpath) and is decoded already for a
 * Markdown link. Null: the link resolves to nothing.
 */
export function resolveLinkpath(linkpath: string, sourcePath: string, vault: LinkVault): string | null {
  return resolveLinkpathDetail(linkpath, sourcePath, vault).path
}

/**
 * `resolveLinkpath`, and whether only the last tie-break chose the file
 * (`byDate`): files of the name equally near and equally long, the one made
 * first winning. Creation times change on a copy, a clone or some syncs, so
 * such a link can mean the other file on another Mac - in Obsidian too.
 */
export function resolveLinkpathDetail(linkpath: string, sourcePath: string, vault: LinkVault): { path: string | null; byDate: boolean } {
  const none = { path: null, byDate: false }
  const target = linkpath.trim()
  if (target === '') return none
  if (target.startsWith('/')) return { path: exact(vault, normalize(target.slice(1)))?.path ?? null, byDate: false }
  const source = folderOf(sourcePath)
  if (target.startsWith('./') || target.startsWith('../')) return { path: exact(vault, normalize(`${source}/${target}`))?.path ?? null, byDate: false }
  const plain = normalize(target)
  const found = exact(vault, plain)
  if (found !== null) return { path: found.path, byDate: false }

  const name = lower(fileName(plain))
  const tail = lower(plain)
  const candidates = (vault.byName.get(name) ?? []).filter((f) => {
    const p = lower(f.path)
    return p.endsWith(`/${tail}`) || p.endsWith(`/${tail}.md`)
  })
  if (candidates.length === 0) return none
  const inside = (p: string): boolean => source === '' || lower(p).startsWith(`${lower(source)}/`)
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(inside(b.path)) - Number(inside(a.path)) ||
      a.path.length - b.path.length ||
      a.ctime - b.ctime ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  )
  const [first, second] = ranked
  return { path: first!.path, byDate: second !== undefined && inside(first!.path) === inside(second.path) && first!.path.length === second.path.length }
}

/** A Markdown link's target as Obsidian writes it: URL-encoded (a space is `%20`). */
const encodeTarget = (s: string): string => encodeURI(s)

/** The path from one folder to a file, `../` up as needed; a file in the same folder is its name. */
function relativePath(fromFolder: string, to: string): string {
  const from = fromFolder === '' ? [] : fromFolder.split('/')
  const parts = to.split('/')
  let same = 0
  while (same < from.length && same < parts.length - 1 && from[same] === parts[same]) same++
  return [...Array<string>(from.length - same).fill('..'), ...parts.slice(same)].join('/')
}

/** How a link to `targetPath` is written in `sourcePath`, by the vault's settings - Obsidian's `generateMarkdownLink`. */
export function formatLink(
  targetPath: string,
  sourcePath: string,
  vault: LinkVault,
  settings: Pick<LinkSettings, 'newLinkFormat' | 'useMarkdownLinks'>,
  opts: { subpath?: string; alias?: string; embed?: boolean; markdown?: boolean } = {},
): string {
  const note = isNote(targetPath)
  const markdown = opts.markdown ?? settings.useMarkdownLinks
  // The path as the format has it; a note's `.md` is left off in a wikilink.
  let written: string
  if (settings.newLinkFormat === 'relative') written = relativePath(folderOf(sourcePath), targetPath)
  else if (settings.newLinkFormat === 'absolute') written = targetPath
  else {
    // Shortest: the name alone when no other file has it, else the whole vault path. The
    // target itself is not counted, so a file about to be made is written right too.
    const others = (vault.byName.get(lower(fileName(targetPath))) ?? []).filter((f) => lower(f.path) !== lower(targetPath))
    written = others.length === 0 ? fileName(targetPath) : targetPath
  }
  const subpath = opts.subpath ?? ''
  const bang = opts.embed === true ? '!' : ''
  if (markdown) {
    const text = opts.alias ?? (note ? linkName(targetPath) : '')
    return `${bang}[${text}](${encodeTarget(written)}${subpath === '' ? '' : encodeTarget(subpath)})`
  }
  const bare = note ? written.replace(/\.md$/i, '') : written
  return `${bang}[[${bare}${subpath}${opts.alias === undefined ? '' : `|${opts.alias}`}]]`
}

/** The characters Obsidian refuses in a file name (its file layer, measured): \ / : */
export const REFUSED_IN_NAME = /[\\/:]/

/** Why a file name cannot be used, by Obsidian's rules, or null. Other files with the same name are fine. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'A name cannot be empty.'
  if (REFUSED_IN_NAME.test(name)) return 'File name cannot contain any of the following characters: \\ / :'
  return null
}

/** What a link reads as its own syntax: a name with one is never found by a link (Obsidian's warning). */
const BREAKS_LINKS = /[#^[\]|]/
/** What Windows refuses in a file name, besides \ / : (refused everywhere). */
const NOT_ON_WINDOWS = /[*"<>?|]/

/**
 * What to know about a name that is allowed: the name is never changed, only
 * warned about, before it is made - links that will not find it (Obsidian's
 * own words), a file a Windows computer cannot hold (a synced vault), a
 * name that hides the file.
 */
export function nameWarnings(name: string): string[] {
  const out: string[] = []
  if (BREAKS_LINKS.test(name)) out.push('Links will not work with file names containing any of these characters: # ^ [ ] |')
  if (NOT_ON_WINDOWS.test(name) || /[. ]$/.test(name)) out.push('This name will not work on Windows: it has one of * " < > ? | or ends in a dot or a space.')
  if (name.startsWith('.')) out.push('A name starting with “.” is hidden, here and in Obsidian.')
  return out
}

/** Whether a folder already has a file with this name - ignoring case, as Obsidian (and the Mac) do. */
export function takenInFolder(folder: string, name: string, paths: Iterable<string>): string | null {
  const want = lower(folder === '' ? name : `${folder}/${name}`)
  for (const p of paths) if (lower(p) === want) return p
  return null
}

/** `text` with `edit` applied to every line outside fenced code (parse.ts nextFence), line endings kept. */
function outsideCode(text: string, edit: (line: string) => string): string {
  let fence: Fence = null
  return text
    .split(/(\r?\n)/)
    .map((part, i) => {
      if (i % 2 === 1) return part
      const next = nextFence(part, fence)
      if (next !== fence) {
        fence = next
        return part
      }
      return fence !== null ? part : edit(part)
    })
    .join('')
}

/**
 * A note's text after files were renamed or moved (`moves`: old path → new
 * path; a folder's move is every file in it), as Obsidian updates it: every
 * link that pointed at a moved file - read from the note where it was, in the
 * vault as it was - is written again for the file's new path in the vault's
 * format, from where the note is now, in the vault as it is now; its alias,
 * subpath and `!` kept, a Markdown link kept a Markdown link with its text.
 * When the note itself moved, a link of its own that would now mean another
 * file (a relative or partial path) is written again for the file it meant.
 * Every other link, and anything in fenced code, is left as it is.
 */
export function rewriteForRename(
  text: string,
  source: { before: string; after: string },
  moves: ReadonlyMap<string, string>,
  before: LinkVault,
  after: LinkVault,
  settings: Pick<LinkSettings, 'newLinkFormat'>,
): { text: string; changed: number } {
  let changed = 0
  /** The file a link should mean now, if it must be written again; null to leave it. */
  const retarget = (target: string): { path: string; subpath: string } | null => {
    const { path, subpath } = splitSubpath(target)
    const meant = resolveLinkpath(path, source.before, before)
    if (meant === null) return null
    const now = moves.get(meant) ?? meant
    if (!moves.has(meant) && resolveLinkpath(path, source.after, after) === now) return null
    return { path: now, subpath }
  }
  const write = (target: { path: string; subpath: string }, markdown: boolean, embed: boolean, alias: string | undefined): string => {
    changed++
    return formatLink(
      target.path,
      source.after,
      after,
      { newLinkFormat: settings.newLinkFormat, useMarkdownLinks: markdown },
      { subpath: target.subpath, embed, ...(alias === undefined ? {} : { alias }) },
    )
  }
  const next = outsideCode(text, (line) =>
    line
      // Wikilinks and embeds: [[target]], [[target|alias]], ![[...]].
      .replace(/(!?)\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (whole, bang: string, target: string, alias: string | undefined) => {
        const hit = retarget(target)
        return hit === null ? whole : write(hit, false, bang === '!', alias)
      })
      // Markdown links: [text](target), ![text](target); targets with a scheme (https:, mailto:) are not files.
      .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, label: string, raw: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return whole
        let target: string
        try {
          target = decodeURI(raw)
        } catch {
          target = raw
        }
        const hit = retarget(target)
        return hit === null ? whole : write(hit, true, bang === '!', label)
      }),
  )
  return { text: next, changed }
}
