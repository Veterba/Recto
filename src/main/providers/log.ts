import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * A short record of what the cloud providers answered - status, OpenAI's code,
 * the request id, sign-in and refresh outcomes - in `<userData>/logs/providers.log`,
 * so a failure for one account can be read after the fact. Never a token, a
 * prompt or a note's text. Kept small: past 200 KB the older half goes.
 */
const MAX_BYTES = 200_000

export function logProvider(line: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'logs', 'providers.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      const kept = fs.readFileSync(file, 'utf8')
      fs.writeFileSync(file, kept.slice(kept.indexOf('\n', kept.length / 2) + 1))
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // No log is better than a failed answer: tests without Electron, a full disk.
  }
}
