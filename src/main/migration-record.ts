import fs from 'node:fs'
import path from 'node:path'

/**
 * A one-time migration's record is there: the file itself, or a copy iCloud
 * made of it (`boards-migration 2.json`) when it could not reconcile two Macs'
 * versions and moved the original aside. A copy means the migration ran, so
 * it does not run again.
 */
export function recordExists(file: string): boolean {
  if (fs.existsSync(file)) return true
  const base = path.basename(file, '.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const copy = new RegExp(`^${base} \\d+\\.json$`)
  try {
    return fs.readdirSync(path.dirname(file)).some((name) => copy.test(name))
  } catch {
    return false
  }
}
