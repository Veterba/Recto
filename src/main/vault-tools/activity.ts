import fs from 'node:fs'
import path from 'node:path'
import { AI_ACTIVITY_FILE, type ActivityEntry } from '../../shared/ai-access'
import { VAULT_STATE_DIR } from '../../shared/vault'
import { currentVault } from '../vault'

/**
 * The activity log: one JSON line per tool call in `.recto/ai-activity.jsonl`
 * - who, which tool, its arguments summarised, the outcome. Never note text:
 * a write's text, a find/replace or properties are logged as their length.
 */

/** Past this size the log keeps its newer half. */
const MAX_BYTES = 2_000_000
/** Arguments that carry note text, logged as a length only. */
const CONTENT = new Set(['text', 'changes', 'properties', 'find', 'replace', 'after_text', 'title'])

const file = (): string | null => {
  const vault = currentVault()
  return vault === null ? null : path.join(vault.path, VAULT_STATE_DIR, AI_ACTIVITY_FILE)
}

export function summariseArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (CONTENT.has(k)) return `${k}: <${JSON.stringify(v).length} chars>`
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}: ${s.length > 80 ? `${s.slice(0, 79)}…` : s}`
    })
    .join(', ')
}

export function logCall(entry: ActivityEntry): void {
  const target = file()
  if (target === null) return
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (fs.existsSync(target) && fs.statSync(target).size > MAX_BYTES) {
      const lines = fs.readFileSync(target, 'utf8').trimEnd().split('\n')
      fs.writeFileSync(target, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`)
    }
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`)
  } catch (err) {
    console.error('[ai-activity]', err)
  }
}

/** The newest entries first. */
export function readActivity(limit = 200): ActivityEntry[] {
  const target = file()
  if (target === null || !fs.existsSync(target)) return []
  return fs
    .readFileSync(target, 'utf8')
    .trimEnd()
    .split('\n')
    .slice(-limit)
    .reverse()
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ActivityEntry]
      } catch {
        return []
      }
    })
}
