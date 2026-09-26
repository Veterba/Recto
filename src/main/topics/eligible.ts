import type { TemplateSettings } from '../../shared/templates'
import { isInFolder } from '../../shared/templates'

/**
 * Which notes auto-links may touch, as source or as target. Daily notes,
 * templates, chats, task cards and attachments never are - they are made by
 * the app or by a template, not written as ideas - plus whatever the user
 * lists. (The archive lives under .recto/, which is never indexed at all.)
 */
const ALWAYS_EXCLUDED = ['chats', 'tasks', 'attachments']

export function excludedFolders(templates: TemplateSettings, extra: readonly string[]): string[] {
  return [templates.daily.folder, templates.folder, ...ALWAYS_EXCLUDED, ...extra]
    .map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
    .filter((f) => f !== '')
}

export const isEligible = (path: string, excluded: readonly string[]): boolean => !excluded.some((folder) => isInFolder(path, folder))
