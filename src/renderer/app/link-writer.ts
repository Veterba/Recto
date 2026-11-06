import { IPC } from '@shared/ipc'
import { formatLink, linkVault, OBSIDIAN_DEFAULTS, type LinkSettings } from '@shared/obsidian-links'
import { api } from './api'

/**
 * Links written in the renderer the way Obsidian writes them
 * (shared/obsidian-links.ts `formatLink`): the vault's "Files and links"
 * settings, read from `.obsidian/app.json` by main, kept here and read again
 * when the window comes back - Obsidian may have changed them meanwhile.
 */

let settings: LinkSettings = OBSIDIAN_DEFAULTS

/** Read the vault's link settings again. */
export function refreshLinkSettings(): void {
  void api.invoke(IPC.linksSettings).then(
    (next) => {
      settings = next
    },
    () => undefined,
  )
}

if (typeof window !== 'undefined') window.addEventListener('focus', refreshLinkSettings)

export const linkSettings = (): LinkSettings => settings

/**
 * A link to the note at `target`, written in the note at `source` ('' for
 * none), with the vault's notes to tell whether its name alone names it.
 */
export function writeLink(
  target: string,
  source: string,
  notes: readonly { path: string }[],
  opts: { subpath?: string; alias?: string; embed?: boolean; markdown?: boolean } = {},
): string {
  return formatLink(target, source, linkVault(notes.map((n) => ({ path: n.path, ctime: 0 }))), settings, opts)
}
