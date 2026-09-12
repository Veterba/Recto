import fs from 'node:fs'
import path from 'node:path'
import { VAULT_STATE_DIR } from '../shared/ipc-contract'
import { currentVault } from './vault'

/**
 * Per-feature JSON state inside `<vault>/.obsidian-like/`.
 *
 * The feature id comes from the renderer, so it is validated as a bare name
 * rather than trusted as a path - a renderer bug must not be able to write
 * `../../.ssh/config`.
 */
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/

function fileFor(feature: string): string {
  if (!FEATURE_ID.test(feature)) throw new Error(`invalid state feature id: ${feature}`)
  const vault = currentVault()
  if (!vault) throw new Error('no vault open')
  return path.join(vault.path, VAULT_STATE_DIR, `${feature}.json`)
}

/** Missing or corrupt state returns null: a bad file must not block startup. */
export function readState(feature: string): unknown {
  let raw: string
  try {
    raw = fs.readFileSync(fileFor(feature), 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeState(feature: string, data: unknown): { ok: boolean; error?: string } {
  try {
    const file = fileFor(feature)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Write-then-rename, so a crash mid-write cannot leave a truncated file
    // that would lose the user's layout on next launch.
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, file)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
