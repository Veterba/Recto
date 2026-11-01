import { RECTO_FOLDER } from '../../shared/recto-paths'
import { isInFolder, periodicFolders, type TemplateSettings } from '../../shared/templates'

/**
 * Which notes topics may touch. Periodic notes,
 * templates, Recto/ (boards, cards, chats) and attachments never are - they are made by
 * the app or by a template, not written as ideas - plus whatever the user
 * lists. (The archive lives under .recto/, which is never indexed at all.)
 */
const ALWAYS_EXCLUDED = [RECTO_FOLDER, 'attachments']

export function excludedFolders(templates: TemplateSettings, extra: readonly string[]): string[] {
  return [...periodicFolders(templates.periodic), templates.folder, ...ALWAYS_EXCLUDED, ...extra]
    .map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
    .filter((f) => f !== '')
}

export const isEligible = (path: string, excluded: readonly string[]): boolean => !excluded.some((folder) => isInFolder(path, folder))
