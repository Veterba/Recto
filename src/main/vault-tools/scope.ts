import path from 'node:path'
import { coerceAiAccess, isExcludedPath, AI_ACCESS_STATE, type AiAccessSettings } from '../../shared/ai-access'
import { pathsByName, resolveLink, shortestLink } from '../../shared/parse'
import { isChatPath } from '../../shared/recto-paths'
import { coerceTemplateSettings, type TemplateSettings } from '../../shared/templates'
import { readState } from '../state'
import { currentVault } from '../vault'
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
  /** Every note in the vault, hidden ones too: names are unique across all of them. */
  allNotes: string[]
  /** The notes a tool may return. */
  notes: string[]
  /** Not for any tool: excluded by the person, Recto's chats, or not a note. */
  hidden: (p: string) => boolean
  /** A note given as a path or a name, as a visible note's path - or null. */
  resolve: (target: string) => string | null
  /** The note's path, or a ToolError saying there is no such note. */
  need: (target: string) => string
  /** How a link to this note is written: its name, or the shortest path that is unique. */
  linkTo: (p: string) => string
}

export const isNote = (p: string): boolean => p.toLowerCase().endsWith('.md')

export function buildScope(client: string): Scope {
  const vault = currentVault()
  if (vault === null) throw new ToolError('No vault is open in Recto. Open one, then try again.')
  const settings = coerceAiAccess(readState(AI_ACCESS_STATE))
  const templates = coerceTemplateSettings(readState('templates'))
  const allNotes = vaultFs.vaultFiles().filter(isNote)
  const hidden = (p: string): boolean => !isNote(p) || isChatPath(p) || isExcludedPath(p, settings.excluded)
  const notes = allNotes.filter((p) => !hidden(p))
  const byName = pathsByName(allNotes)
  const all = new Set(allNotes)
  const lower = new Map(allNotes.map((p) => [p.toLowerCase(), p]))

  const resolve = (target: string): string | null => {
    const clean = target
      .trim()
      .replace(/^\[\[|\]\]$/g, '')
      .replace(/^\/+/, '')
    if (clean === '') return null
    const exact = lower.get(clean.toLowerCase()) ?? lower.get(`${clean.toLowerCase()}.md`)
    const found = exact ?? resolveLink(clean.replace(/\.md$/i, ''), byName, all)
    return found === null || hidden(found) ? null : found
  }

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
      const found = resolve(target)
      // An excluded note is "no note": saying it exists would already say something about it.
      if (found === null) throw new ToolError(`No note “${target}” in this vault. Use search_notes to find it.`)
      return found
    },
    linkTo: (p) => shortestLink(p, allNotes),
  }
}

export const titleOf = (p: string): string => path.posix.basename(p).replace(/\.md$/i, '')
export const folderOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export async function readNote(p: string): Promise<string> {
  const read = await vaultFs.readFile(p)
  if (!read.ok) throw new ToolError(`“${p}” could not be read: ${read.error}`)
  return read.content
}
