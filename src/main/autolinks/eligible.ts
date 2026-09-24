import type { TemplateSettings } from '../../renderer/core/templates'
import { isInFolder } from '../../renderer/core/templates'

/**
 * Which notes auto-links may touch, as source or as target. Daily notes,
 * templates, chats, task cards and attachments never are - they are made by
 * the app or by a template, not written as ideas - plus whatever the user
 * lists. (The archive lives under .recto/, which is never indexed at all.)
 */
export const ALWAYS_EXCLUDED = ['chats', 'tasks', 'attachments']

export function excludedFolders(templates: TemplateSettings, extra: readonly string[]): string[] {
  return [templates.daily.folder, templates.folder, ...ALWAYS_EXCLUDED, ...extra]
    .map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
    .filter((f) => f !== '')
}

export const isEligible = (path: string, excluded: readonly string[]): boolean =>
  !excluded.some((folder) => isInFolder(path, folder))

/** Two notes with one name are versions of each other, not related ideas: never linked. */
export const sameName = (a: string, b: string): boolean => {
  const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '').normalize('NFC').toLowerCase()
  return base(a) === base(b)
}
