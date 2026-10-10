import fs from 'node:fs'
import path from 'node:path'
import { BOTS_FOLDER, CHATS_FOLDER } from '../../shared/bots'
import { readState, writeState } from '../state'
import { currentVault } from '../vault'

/**
 * Whether bots run in this vault. Experimental, like topics: off in a new
 * vault, and when off nothing of theirs runs - no Ollama call, no model kept
 * loaded, no note cards or chunk vectors, no embedder work for them.
 *
 * Kept per vault in `.recto/bots-settings.json`. A vault without that file
 * that already has bots (their definitions or a chats folder) keeps them on;
 * the answer is written down at once, so the folders bots create later can
 * never turn a new vault's "off" into "on".
 */

const FEATURE = 'bots-settings'

export function botsEnabled(): boolean {
  const vault = currentVault()
  if (vault === null) return false
  const stored = readState(FEATURE) as { enabled?: unknown } | null
  if (typeof stored?.enabled === 'boolean') return stored.enabled
  const used = fs.existsSync(path.join(vault.path, BOTS_FOLDER)) || fs.existsSync(path.join(vault.path, CHATS_FOLDER))
  writeState(FEATURE, { enabled: used })
  return used
}

export function writeBotsEnabled(on: boolean): void {
  writeState(FEATURE, { enabled: on })
}
