import fs from 'node:fs'
import path from 'node:path'
import { CHATS_FOLDER } from '../../shared/bots'
import { createdStamp, fallbackTitle, parseTopic, topicFile, topicFileName } from '../../shared/chat-topics'

/**
 * Once per vault: the old main chat's conversations (`chats/*.md`) and the
 * first bots' threads (`chats/recto/*.md`) become Recto's chat topics.
 *
 * Each file moves to `chats/recto/<created> — <title>.md` with the topic
 * frontmatter (bot, created, title) in front of its body, and the body - every
 * message - is kept byte for byte. Before anything moves, the whole `chats/`
 * folder is copied to `.recto/backups/chats-<date>/`. A conversation with no
 * messages is not carried over (it is in the backup). What was done is written
 * to `.recto/chats-migration.json`, and that file's existence is what stops it
 * from ever running again.
 */

export const MIGRATION_RECORD = '.recto/chats-migration.json'
const RECTO = 'recto'

export type MigrationReport = {
  at: string
  backup: string | null
  moved: { from: string; to: string; title: string }[]
  skipped: { path: string; reason: string }[]
}

/** `2026-09-24 21-36-13.md` → `2026-09-24T21:36`; anything else, the file's own time. */
function createdOf(name: string, mtime: Date): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})/.exec(name)
  return match === null ? createdStamp(mtime) : `${match[1]}T${match[2]}:${match[3]}`
}

/** A free name in `dir`: `<stem>.md`, else `<stem> (2).md`, and so on. */
function freeName(dir: string, name: string, taken: Set<string>): string {
  const stem = name.replace(/\.md$/i, '')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem}.md` : `${stem} (${n}).md`
    if (!taken.has(candidate) && !fs.existsSync(path.join(dir, candidate))) return candidate
  }
}

/** Does this file already have the topic frontmatter (written by this app since)? */
const isTopic = (text: string): boolean => parseTopic(text, []).meta.bot !== undefined

export function migrateChats(vault: string, now: Date = new Date()): MigrationReport | null {
  const record = path.join(vault, MIGRATION_RECORD)
  if (fs.existsSync(record)) return null
  const chats = path.join(vault, CHATS_FOLDER)
  const report: MigrationReport = { at: now.toISOString(), backup: null, moved: [], skipped: [] }

  const candidates: { file: string; relative: string }[] = []
  const collect = (dir: string, relative: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        candidates.push({ file: path.join(dir, entry.name), relative: `${relative}/${entry.name}` })
    }
  }
  collect(chats, CHATS_FOLDER)
  collect(path.join(chats, RECTO), `${CHATS_FOLDER}/${RECTO}`)

  if (candidates.length > 0) {
    let backup = path.join(vault, '.recto', 'backups', `chats-${now.toISOString().slice(0, 10)}`)
    for (let n = 2; fs.existsSync(backup); n++)
      backup = path.join(vault, '.recto', 'backups', `chats-${now.toISOString().slice(0, 10)}-${n}`)
    fs.cpSync(chats, backup, { recursive: true })
    report.backup = path.relative(vault, backup)
  }

  const target = path.join(chats, RECTO)
  fs.mkdirSync(target, { recursive: true })
  const taken = new Set<string>()
  for (const { file, relative } of candidates) {
    const text = fs.readFileSync(file, 'utf8')
    if (isTopic(text)) {
      report.skipped.push({ path: relative, reason: 'already a topic' })
      continue
    }
    const parsed = parseTopic(text, ['Recto', 'Claude'])
    if (parsed.messages.length === 0) {
      report.skipped.push({ path: relative, reason: 'no messages (kept in the backup)' })
      fs.rmSync(file)
      continue
    }
    // The old title: the conversation's H1, unless it is the placeholder.
    const h1 = /^#\s+(.+?)\s*$/m.exec(parsed.body)?.[1]?.trim()
    const title = h1 !== undefined && h1 !== '' && h1 !== 'New chat' ? h1 : fallbackTitle(parsed.messages)
    const created = createdOf(path.basename(file), fs.statSync(file).mtime)
    // Keep the old frontmatter's other keys (the model), but not `recto: chat`: `bot:` says it now.
    const extra = parsed.extra.filter((line) => !/^recto:\s*chat\s*$/.test(line))
    const name = freeName(target, topicFileName(created, title), taken)
    taken.add(name)
    const { atime, mtime } = fs.statSync(file)
    fs.writeFileSync(path.join(target, name), topicFile({ bot: RECTO, created, title }, extra, parsed.body), 'utf8')
    // Its time stays its own: the sidebar shows when a conversation was last written to, not when it moved.
    fs.utimesSync(path.join(target, name), atime, mtime)
    if (path.join(target, name) !== file) fs.rmSync(file)
    report.moved.push({ from: relative, to: `${CHATS_FOLDER}/${RECTO}/${name}`, title })
  }

  fs.mkdirSync(path.dirname(record), { recursive: true })
  fs.writeFileSync(record, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}
