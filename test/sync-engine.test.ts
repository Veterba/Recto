import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nested, previewSync, runSync, type EngineOptions } from '../src/main/sync/engine'

/**
 * The whole cycle, on real folders. Everything the planner promises is checked
 * here against actual files, because that is where a sync goes wrong.
 */

let root: string
let recto: string
let obsidian: string
let archived: string[]
let options: EngineOptions

const write = async (dir: string, rel: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
  await fs.writeFile(path.join(dir, rel), text)
}
const read = (dir: string, rel: string): Promise<string> => fs.readFile(path.join(dir, rel), 'utf8')
const has = async (dir: string, rel: string): Promise<boolean> =>
  fs.access(path.join(dir, rel)).then(
    () => true,
    () => false,
  )
const files = async (dir: string): Promise<string[]> => {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else out.push(path.relative(dir, p).split(path.sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}
/** mtime granularity: make sure a rewrite is seen as a change. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'recto-sync-'))
  recto = path.join(root, 'recto')
  obsidian = path.join(root, 'obsidian')
  await fs.mkdir(recto)
  await fs.mkdir(obsidian)
  archived = []
  options = {
    rectoRoot: recto,
    obsidianRoot: obsidian,
    manifestFile: path.join(root, 'manifest.json'),
    archiveInRecto: async (rel) => {
      archived.push(rel)
      await fs.rm(path.join(recto, rel))
    },
    now: () => new Date(2026, 8, 14, 10, 32),
  }
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('first sync', () => {
  it('merges both vaults, folders included, and deletes nothing', async () => {
    await write(recto, 'School/algebra.md', 'from recto')
    await write(obsidian, 'Daily/2026-09-14.md', 'from obsidian')
    await write(obsidian, 'attachments/diagram.png', 'PNGDATA')
    const outcome = await runSync(options)
    expect(outcome.ok).toBe(true)
    const expected = ['Daily/2026-09-14.md', 'School/algebra.md', 'attachments/diagram.png']
    expect(await files(recto)).toEqual(expected)
    expect(await files(obsidian)).toEqual(expected)
    expect(await read(recto, 'Daily/2026-09-14.md')).toBe('from obsidian')
  })

  it('never touches either app’s own folder', async () => {
    await write(recto, '.recto/appearance.json', '{"recto":true}')
    await write(obsidian, '.obsidian/app.json', '{"obsidian":true}')
    await runSync(options)
    expect(await has(obsidian, '.recto/appearance.json')).toBe(false)
    expect(await has(recto, '.obsidian/app.json')).toBe(false)
  })

  it('keeps both versions of a note that differs on each side', async () => {
    await write(recto, 'plan.md', 'recto version')
    await write(obsidian, 'plan.md', 'obsidian version')
    const outcome = await runSync(options)
    expect(outcome.ok && outcome.report.conflicts.length).toBe(1)
    // The newer version keeps the path; the other is saved beside it, named
    // for the side it came from.
    const copies = (await files(recto)).filter((f) => f.includes('conflict'))
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^plan \((Recto|Obsidian) conflict 2026-09-14 10-32\)\.md$/)
    // Every version exists on both sides, under one of the two names.
    for (const dir of [recto, obsidian]) {
      const texts = await Promise.all((await files(dir)).map((f) => read(dir, f)))
      expect(texts.sort()).toEqual(['obsidian version', 'recto version'])
    }
  })

  it('previews without writing anything', async () => {
    await write(recto, 'a.md', 'a')
    await write(obsidian, 'b.md', 'b')
    const preview = await previewSync(options)
    expect(preview).toEqual({ ok: true, summary: { toRecto: 1, toObsidian: 1, deleteInRecto: 0, deleteInObsidian: 0, conflicts: 0 } })
    expect(await files(recto)).toEqual(['a.md'])
    expect(await files(obsidian)).toEqual(['b.md'])
  })
})

describe('keeping in sync', () => {
  beforeEach(async () => {
    await write(recto, 'note.md', 'v1')
    await runSync(options)
  })

  it('does nothing on a pass with no changes', async () => {
    const outcome = await runSync(options)
    expect(outcome.ok && outcome.report.summary).toEqual({ toRecto: 0, toObsidian: 0, deleteInRecto: 0, deleteInObsidian: 0, conflicts: 0 })
  })

  it('carries an edit in Obsidian into Recto', async () => {
    await tick()
    await write(obsidian, 'note.md', 'edited in obsidian')
    await runSync(options)
    expect(await read(recto, 'note.md')).toBe('edited in obsidian')
  })

  it('carries an edit in Recto into Obsidian', async () => {
    await tick()
    await write(recto, 'note.md', 'edited in recto')
    await runSync(options)
    expect(await read(obsidian, 'note.md')).toBe('edited in recto')
  })

  it('archives in Recto what was deleted in Obsidian - recoverable, not gone', async () => {
    await fs.rm(path.join(obsidian, 'note.md'))
    await runSync(options)
    expect(archived).toEqual(['note.md'])
    expect(await has(recto, 'note.md')).toBe(false)
  })

  it('moves to Obsidian’s .trash what was deleted in Recto', async () => {
    await fs.rm(path.join(recto, 'note.md'))
    await runSync(options)
    expect(await has(obsidian, 'note.md')).toBe(false)
    expect(await read(obsidian, '.trash/note.md')).toBe('v1')
  })

  it('does not bounce: a pass after a carried edit changes nothing', async () => {
    await tick()
    await write(obsidian, 'note.md', 'v2')
    await runSync(options)
    const second = await runSync(options)
    expect(second.ok && second.report.summary.toRecto + second.report.summary.toObsidian).toBe(0)
  })

  it('lets an edit survive a deletion on the other side', async () => {
    await tick()
    await write(obsidian, 'note.md', 'kept by the edit')
    await fs.rm(path.join(recto, 'note.md'))
    await runSync(options)
    expect(await read(recto, 'note.md')).toBe('kept by the edit')
  })
})

describe('refusing to do damage', () => {
  it('stops when the Obsidian folder is missing, instead of deleting everything', async () => {
    await write(recto, 'note.md', 'v1')
    await runSync(options)
    await fs.rm(obsidian, { recursive: true })
    expect(await runSync(options)).toEqual({ ok: false, reason: 'missing', side: 'obsidian' })
    expect(await read(recto, 'note.md')).toBe('v1')
  })

  it('stops a pass that would delete most of a side, until forced', async () => {
    for (let i = 0; i < 40; i++) await write(recto, `n${i}.md`, `note ${i}`)
    await runSync(options)
    // An emptied-out Obsidian folder that still exists: the dangerous case.
    for (let i = 0; i < 40; i++) await fs.rm(path.join(obsidian, `n${i}.md`))
    const stopped = await runSync(options)
    expect(stopped).toMatchObject({ ok: false, reason: 'guard', side: 'recto', count: 40 })
    expect((await files(recto)).length).toBe(40)
    const forced = await runSync({ ...options, force: true })
    expect(forced.ok).toBe(true)
    expect(archived.length).toBe(40)
  })

  it('refuses a vault inside the other', () => {
    expect(nested('/v/recto', '/v/recto/obsidian')).toBe(true)
    expect(nested('/v/recto', '/v/obsidian')).toBe(false)
  })
})
