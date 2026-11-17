import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, open, requireDb } from '../../../src/workers/indexer/db'
import { writeNote } from '../../../src/workers/indexer/index'
import { search } from '../../../src/workers/indexer/queries'

/** A damaged index.db is set aside and a new one built, instead of failing every open. Real SQLite. */

let root = ''
afterEach(() => {
  closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

const setup = (): string => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-damaged-index-'))
  return path.join(root, '.recto', 'index.db')
}
const asideFiles = (): string[] => fs.readdirSync(path.join(root, '.recto')).filter((f) => f.includes('.corrupt-'))

describe('a damaged index', () => {
  it('a file that is not a database is set aside and a fresh index opens', () => {
    const dbPath = setup()
    fs.mkdirSync(path.dirname(dbPath))
    fs.writeFileSync(dbPath, 'garbage '.repeat(1000))
    fs.writeFileSync(`${dbPath}-wal`, 'more garbage')

    const opened = open(root, dbPath)

    expect(opened.migratedFrom).toBe(0)
    expect(opened.migratedTo).toBeGreaterThan(0)
    const aside = asideFiles()
    // SQLite itself drops a WAL it cannot read when the failed connection closes; the file is what is kept.
    const copy = aside.find((f) => /^index\.db\.corrupt-[\dTZ-]+$/.test(f))!
    expect(copy).toBeDefined()
    // The set-aside copy keeps what was there.
    expect(fs.readFileSync(path.join(root, '.recto', copy), 'utf8')).toContain('garbage')
    // And the new index works.
    requireDb().transaction(() => writeNote('Basil.md', '# Basil\n\nWater once.', 1, 20))()
    expect(search('water', 5).map((h) => h.path)).toEqual(['Basil.md'])
  })

  it('a database with a damaged schema page is set aside too', () => {
    const dbPath = setup()
    open(root, dbPath)
    closeDb()
    // Page 1 holds the schema; past the 100-byte header, overwrite it.
    const fd = fs.openSync(dbPath, 'r+')
    fs.writeSync(fd, Buffer.alloc(2000, 0xab), 0, 2000, 100)
    fs.closeSync(fd)
    for (const suffix of ['-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })

    expect(open(root, dbPath).migratedFrom).toBe(0)
    expect(asideFiles().length).toBeGreaterThan(0)
  })

  it('a healthy index is opened as it is', () => {
    const dbPath = setup()
    open(root, dbPath)
    requireDb().transaction(() => writeNote('Basil.md', '# Basil\n\nWater once.', 1, 20))()
    closeDb()

    const opened = open(root, dbPath)

    expect(opened.migratedFrom).toBe(opened.migratedTo)
    expect(asideFiles()).toEqual([])
    expect(search('water', 5).map((h) => h.path)).toEqual(['Basil.md'])
  })

  it('a failure that is not damage still throws and leaves the file alone', () => {
    const dbPath = setup()
    fs.mkdirSync(dbPath, { recursive: true })

    expect(() => open(root, dbPath)).toThrow()
    expect(fs.statSync(dbPath).isDirectory()).toBe(true)
    expect(asideFiles()).toEqual([])
    expect(() => requireDb()).toThrow('index not open')
  })
})
