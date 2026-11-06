import fs from 'node:fs'
import path from 'node:path'
import { linkVault, settingsFromAppJson, type LinkFile, type LinkSettings, type LinkVault } from '../shared/obsidian-links'
import { currentVault } from './vault'
import { vaultFiles } from './vault-fs'

/**
 * What reading and writing a link needs, in main: the vault's files with when
 * each was made (Obsidian's order among same-named files equally near), and
 * Obsidian's link settings from `.obsidian/app.json` - read; written only by
 * "Always update", as Obsidian does.
 * See src/shared/obsidian-links.ts and docs/dev/obsidian-link-rules.md.
 */

/** A file's creation time; a file that cannot be read counts as made now. */
function ctimeOf(root: string, relative: string): number {
  try {
    const stat = fs.statSync(path.join(root, relative))
    return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs
  } catch {
    return Date.now()
  }
}

/** The vault's files, indexed for links. */
export function currentLinkVault(): LinkVault {
  const vault = currentVault()
  if (vault === null) return linkVault([])
  const files: LinkFile[] = vaultFiles().map((p) => ({ path: p, ctime: ctimeOf(vault.path, p) }))
  return linkVault(files)
}

/** Where Recto keeps the same settings for a vault Obsidian has never opened: no `.obsidian/` folder is made for it. */
const RECTO_LINK_SETTINGS = path.join('.recto', 'link-settings.json')

const readText = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Obsidian's link settings for this vault: its `.obsidian/app.json`; for a
 * vault with no `.obsidian/`, Recto's own copy of them; else Obsidian's defaults.
 */
export function currentLinkSettings(): LinkSettings {
  const vault = currentVault()
  if (vault === null) return settingsFromAppJson(null)
  if (fs.existsSync(path.join(vault.path, '.obsidian'))) return settingsFromAppJson(readText(path.join(vault.path, '.obsidian', 'app.json')))
  return settingsFromAppJson(readText(path.join(vault.path, RECTO_LINK_SETTINGS)))
}

/**
 * "Always update" in the Update links dialog: as in Obsidian, the vault's
 * "Automatically update internal links" turned on - in `.obsidian/app.json`,
 * every other setting there kept, or in Recto's copy for a vault with no `.obsidian/`.
 */
export function rememberAlwaysUpdate(): void {
  const vault = currentVault()
  if (vault === null) return
  const obsidian = path.join(vault.path, '.obsidian')
  const file = fs.existsSync(obsidian) ? path.join(obsidian, 'app.json') : path.join(vault.path, RECTO_LINK_SETTINGS)
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(readText(file) ?? '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
  } catch {
    // A file that is not JSON is not overwritten: the choice holds for this time only.
    if (readText(file) !== null) return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, alwaysUpdateLinks: true }, null, 2)}`)
}
