import path from 'node:path'
import { coerceAiAccess, isExcludedPath, AI_ACCESS_STATE, type AiAccessSettings } from '../../shared/ai-access'
import { formatLink, linkVault, resolveLinkpath, splitSubpath } from '../../shared/obsidian-links'
import { isChatPath } from '../../shared/recto-paths'
import { coerceTemplateSettings, type TemplateSettings } from '../../shared/templates'
import { readState } from '../state'
import { currentVault } from '../vault'
import { currentLinkSettings, currentLinkVault } from '../link-context'
import { realPath } from '../paths'
import * as vaultFs from '../vault-fs'

/**
 * What one tool call works in: the open vault, its AI settings, and which
 * notes the call may see. Built fresh per call, so a setting changed a second
 * ago - a newly excluded folder - holds for the very next call.
 */

/** A rule broken, or a call that cannot be done: the message is what the AI reads. */
export class ToolError extends Error {}

export type Scope = {
  vault: string
  settings: AiAccessSettings
  templates: TemplateSettings
  client: string
  /** Every note in the vault, hidden ones too: a link is read against all of them. */
  allNotes: string[]
  /** The notes a tool may return. */
  notes: string[]
  /** Not for any tool: excluded by the person, Recto's chats, or not a note. */
  hidden: (p: string) => boolean
  /**
   * The visible note a link means, read from the note it is in (`source`), by
   * Obsidian's rules (shared/obsidian-links.ts) - or null. Without `source`, a
   * name a tool was given: the visible note of that name when the vault's pick
   * is hidden.
   */
  resolve: (target: string, source?: string) => string | null
  /**
   * The note a tool is given, as a path or a name: its path, or a ToolError -
   * no such note, or a name several notes have (each listed, to give one by path).
   */
  need: (target: string) => string
  /** What goes inside `[[ ]]` for a link to `p` written in `source`, as Obsidian writes it - right even before `p` exists. */
  linkTo: (p: string, source: string) => string
  /** Not for any tool, as a file of any kind: excluded by the person, Recto's chats, or outside what the call may see. */
  fileHidden: (p: string) => boolean
  /** The visible file of any kind a link (from `source`) or a name (no `source`) means - or null, as `resolve`. */
  resolveFile: (target: string, source?: string) => string | null
  /** The file a tool is given, as a path or a name with its extension: its path, or a ToolError - none, or a name several files have. */
  needFile: (target: string) => string
  /**
   * Whether a link from `source` points at a file that exists, whether or not
   * this call may read it - so a note beyond Quick ask's reach is not taken for
   * a missing one. Excluded files and chats count as missing, as everywhere.
   */
  exists: (target: string, source?: string) => boolean
}

export const isNote = (p: string): boolean => p.toLowerCase().endsWith('.md')

/** What a session (sessions.ts) narrows the vault to: only these notes are there at all, and these folders are excluded too. */
export type ScopeLimit = { notes: ReadonlySet<string> | null; exclude?: readonly string[] }

export function buildScope(client: string, limit: ScopeLimit = { notes: null }): Scope {
  const vault = currentVault()
  if (vault === null) throw new ToolError('No vault is open in Recto. Open one, then try again.')
  const stored = coerceAiAccess(readState(AI_ACCESS_STATE))
  const settings = { ...stored, excluded: [...stored.excluded, ...(limit.exclude ?? [])] }
  const templates = coerceTemplateSettings(readState('templates'))
  const allNotes = vaultFs.vaultFiles().filter(isNote)
  const listed = new Set(allNotes)
  /**
   * A path not in the vault's list - a note about to be made - as the disk
   * would take it: through a symlinked folder it lands where the link points,
   * and there it may be excluded (or not in the vault at all). Listed paths
   * never go through a link (vault-fs.ts skips them).
   */
  const viaLink = (p: string): boolean => {
    if (listed.has(p)) return false
    let real: string
    try {
      real = path.relative(realPath(vault.path), realPath(path.join(vault.path, p))).split(path.sep).join('/')
    } catch {
      return true // a loop of links: nowhere to write
    }
    return real.startsWith('../') || path.isAbsolute(real) || (real !== p && (isChatPath(real) || isExcludedPath(real, settings.excluded)))
  }
  const hidden = (p: string): boolean =>
    !isNote(p) || isChatPath(p) || isExcludedPath(p, settings.excluded) || (limit.notes !== null && !limit.notes.has(p)) || viaLink(p)
  const notes = allNotes.filter((p) => !hidden(p))
  const files = currentLinkVault()
  const format = { newLinkFormat: currentLinkSettings().newLinkFormat, useMarkdownLinks: false }

  const clean = (target: string): string => splitSubpath(target.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0]!.replace(/\\$/, '')).path.trim()
  const fileHidden = (p: string): boolean =>
    isChatPath(p) || isExcludedPath(p, settings.excluded) || (limit.notes !== null && !limit.notes.has(p))
  /** The files a tool may see, to find a name in when the vault's pick for it is one it may not. */
  const seen = linkVault([...files.byPath.values()].filter((f) => !fileHidden(f.path)))
  /**
   * A link in a note (`source` given) means what it opens for the person: a hidden file is no file. A name a
   * tool was given (no `source`) is looked for among what the tool may see when the vault's pick is hidden -
   * `Plan` is the visible Work/Plan.md, though [[Plan]] opens an excluded A/Plan.md.
   */
  const find = (target: string, source: string | undefined, isHidden: (p: string) => boolean): string | null => {
    const found = resolveLinkpath(clean(target), source ?? '', files)
    if (found !== null && !isHidden(found)) return found
    if (source !== undefined) return null
    const named = resolveLinkpath(clean(target), '', seen)
    return named === null || isHidden(named) ? null : named
  }
  const resolve = (target: string, source?: string): string | null => find(target, source, hidden)
  const resolveFile = (target: string, source?: string): string | null => find(target, source, fileHidden)

  return {
    vault: vault.path,
    settings,
    templates,
    client,
    allNotes,
    notes,
    hidden,
    resolve,
    need: (target) => {
      const name = clean(target)
      // A bare name several visible notes have: which one is not guessed.
      if (!name.includes('/')) {
        const want = name.replace(/\.md$/i, '').toLowerCase()
        const same = notes.filter((p) => titleOf(p).toLowerCase() === want)
        if (same.length > 1)
          throw new ToolError(`${same.length} notes are called “${titleOf(same[0]!)}”: ${same.join(', ')}. Give the one you mean by its path.`)
      }
      const found = resolve(target)
      // An excluded note is "no note": saying it exists would already say something about it.
      if (found === null) throw new ToolError(`No note “${target}” in this vault. Use search_notes to find it.`)
      return found
    },
    linkTo: (p, source) => formatLink(p, source, files, format, { markdown: false }).slice(2, -2),
    fileHidden,
    resolveFile,
    needFile: (target) => {
      const name = clean(target)
      if (!name.includes('/')) {
        const same = [...files.byPath.values()].map((f) => f.path).filter((p) => !fileHidden(p) && path.posix.basename(p).toLowerCase() === name.toLowerCase())
        if (same.length > 1) throw new ToolError(`${same.length} files are called “${name}”: ${same.join(', ')}. Give the one you mean by its path.`)
      }
      const found = resolveFile(target)
      // An excluded file is "no file": saying it exists would already say something about it.
      if (found === null) throw new ToolError(`No file “${target}” in this vault. Give its path, or its name with its extension (report.pdf).`)
      return found
    },
    exists: (target, source = '') => {
      const found = resolveLinkpath(clean(target), source, files)
      return found !== null && !isChatPath(found) && !isExcludedPath(found, settings.excluded)
    },
  }
}

export const titleOf = (p: string): string => path.posix.basename(p).replace(/\.md$/i, '')
export const folderOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export async function readNote(p: string): Promise<string> {
  const read = await vaultFs.readFile(p)
  if (!read.ok) {
    // The reason stays here: it can carry the file's path on this Mac.
    console.error('[vault-tools] read', p, read.error)
    throw new ToolError(`“${p}” could not be read.`)
  }
  return read.content
}
