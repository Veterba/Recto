import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATION_RECORD, migrateChats } from '../../../src/main/bots/migration'
import { appendTurns, cleanTitle, fallbackTitle, parseTopic, topicFile, topicFileName } from '../../../src/shared/chat-topics'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function vault(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-migrate-'))
  dirs.push(root)
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), content)
  }
  return root
}

const MAIN_CHAT_BODY =
  '\n# Soil question\n\n## You\n\nHow deep should raised beds be?\n\n## Claude\n\nAbout 30 cm.\n\n```md\n## You\nnot a turn\n```\n'
const MAIN_CHAT = `---\nrecto: chat\nmodel: claude-opus-5\n---\n${MAIN_CHAT_BODY}`
const BOT_THREAD_BODY =
  '\n# hei\n\n## You\n\nhei\n\n## Recto\n\nHello!\n\n## You\n\nWhat goes in the mix?\n\n## Recto\n\nCompost.\n\n<!-- recto:sources [{"path":"Garden/Soil.md","heading":null}] -->\n'
const BOT_THREAD = `---\nrecto: chat\n---\n${BOT_THREAD_BODY}`
const EMPTY_CHAT = '---\nrecto: chat\nmodel: claude-opus-5\n---\n\n# New chat\n'

describe('chats become Recto topics', () => {
  it('moves every conversation into chats/recto with the topic frontmatter, the body byte for byte', () => {
    const root = vault({
      'chats/2026-09-24 21-36-13.md': MAIN_CHAT,
      'chats/2026-09-25 08-00-00.md': EMPTY_CHAT,
      'chats/recto/2026-10-02 13-54-11.md': BOT_THREAD,
      'Garden/Soil.md': '# Soil',
    })
    const report = migrateChats(root, new Date('2026-10-03T09:00:00'))!

    expect(report.moved.map((m) => m.to).sort()).toEqual([
      'chats/recto/2026-09-24 21-36 — Soil question.md',
      'chats/recto/2026-10-02 13-54 — hei.md',
    ])
    const moved = fs.readFileSync(path.join(root, 'chats/recto/2026-09-24 21-36 — Soil question.md'), 'utf8')
    expect(moved).toBe(`---\nbot: recto\ncreated: 2026-09-24T21:36\ntitle: Soil question\nmodel: claude-opus-5\n---\n${MAIN_CHAT_BODY}`)
    const parsed = parseTopic(moved, ['Recto', 'Claude'])
    expect(parsed.messages.map((m) => [m.role, m.label])).toEqual([
      ['user', undefined],
      ['assistant', 'Claude'],
    ])
    const thread = parseTopic(fs.readFileSync(path.join(root, 'chats/recto/2026-10-02 13-54 — hei.md'), 'utf8'), ['Recto'])
    expect(thread.messages.at(-1)!.sources).toEqual([{ path: 'Garden/Soil.md', heading: null }])
    expect(thread.body).toBe(BOT_THREAD_BODY)

    // The old files are gone, the empty chat is not carried over, nothing else is touched.
    expect(fs.readdirSync(path.join(root, 'chats')).sort()).toEqual(['recto'])
    expect(report.skipped).toEqual([{ path: 'chats/2026-09-25 08-00-00.md', reason: 'no messages (kept in the backup)' }])
    expect(fs.readFileSync(path.join(root, 'Garden/Soil.md'), 'utf8')).toBe('# Soil')
  })

  it('keeps each conversation’s own time', () => {
    const root = vault({ 'chats/2026-09-24 21-36-13.md': MAIN_CHAT })
    const then = new Date('2026-09-24T21:40:00')
    fs.utimesSync(path.join(root, 'chats/2026-09-24 21-36-13.md'), then, then)
    migrateChats(root)
    expect(fs.statSync(path.join(root, 'chats/recto/2026-09-24 21-36 — Soil question.md')).mtime.getTime()).toBe(then.getTime())
  })

  it('copies the whole chats folder to .recto/backups first', () => {
    const root = vault({ 'chats/2026-09-24 21-36-13.md': MAIN_CHAT, 'chats/2026-09-25 08-00-00.md': EMPTY_CHAT })
    const report = migrateChats(root, new Date('2026-10-03T09:00:00'))!
    expect(report.backup).toBe('.recto/backups/chats-2026-10-03')
    expect(fs.readFileSync(path.join(root, '.recto/backups/chats-2026-10-03/2026-09-24 21-36-13.md'), 'utf8')).toBe(MAIN_CHAT)
    expect(fs.readFileSync(path.join(root, '.recto/backups/chats-2026-10-03/2026-09-25 08-00-00.md'), 'utf8')).toBe(EMPTY_CHAT)
  })

  it('runs once: the record in .recto stops it ever running again', () => {
    const root = vault({ 'chats/2026-09-24 21-36-13.md': MAIN_CHAT })
    expect(migrateChats(root)).not.toBeNull()
    expect(fs.existsSync(path.join(root, MIGRATION_RECORD))).toBe(true)
    fs.writeFileSync(path.join(root, 'chats/2026-09-30 10-00-00.md'), MAIN_CHAT)
    expect(migrateChats(root)).toBeNull()
    expect(fs.existsSync(path.join(root, 'chats/2026-09-30 10-00-00.md'))).toBe(true)
  })

  it('a vault with no chats only records that it ran', () => {
    const root = vault({ 'Ideas.md': '# Ideas' })
    expect(migrateChats(root)).toMatchObject({ backup: null, moved: [], skipped: [] })
  })

  it('two conversations that would get the same name both survive', () => {
    const root = vault({ 'chats/2026-09-24 21-36-13.md': MAIN_CHAT, 'chats/2026-09-24 21-36-50.md': MAIN_CHAT })
    const report = migrateChats(root)!
    expect(report.moved.map((m) => m.to).sort()).toEqual([
      'chats/recto/2026-09-24 21-36 — Soil question (2).md',
      'chats/recto/2026-09-24 21-36 — Soil question.md',
    ])
  })
})

describe('chat topic files', () => {
  it('appending a turn leaves what was there byte for byte', () => {
    const body = MAIN_CHAT_BODY
    const next = appendTurns(body, [{ role: 'user', content: 'And for carrots?' }], 'Recto')
    expect(next.startsWith(body.trimEnd())).toBe(true)
    expect(next.endsWith('## You\n\nAnd for carrots?\n')).toBe(true)
  })

  it('writes and reads back the frontmatter, quoting a title YAML would misread', () => {
    const text = topicFile({ bot: 'recto', created: '2026-10-02T15:30', title: 'Plan: week 2' }, [], '## You\n\nhi\n')
    expect(text).toContain('title: "Plan: week 2"')
    expect(parseTopic(text, ['Recto']).meta).toEqual({ bot: 'recto', created: '2026-10-02T15:30', title: 'Plan: week 2' })
  })

  it('names files by when they began and what they are about, safely', () => {
    expect(topicFileName('2026-10-02T15:30', 'Soil mix')).toBe('2026-10-02 15-30 — Soil mix.md')
    expect(topicFileName('2026-10-02T15:30', 'a/b: c?')).toBe('2026-10-02 15-30 — a b c.md')
    expect(fallbackTitle([{ role: 'user', content: 'How deep should raised beds be for carrots?' }])).toBe('How deep should raised beds')
  })
})

describe('topic titles', () => {
  it('cleans what the model writes into a short sentence-case title', () => {
    expect(cleanTitle('Topics Naming Decision Confirmed')).toBe('Topics naming decision confirmed')
    expect(cleanTitle('"Title: Soil Mix For CSS Beds."')).toBe('Soil mix for CSS beds')
    expect(cleanTitle('Soil mix for raised beds and more words here')).toBe('Soil mix for raised beds')
    expect(cleanTitle('Названия тем')).toBe('Названия тем')
    expect(cleanTitle('\n\n')).toBeNull()
  })
})
