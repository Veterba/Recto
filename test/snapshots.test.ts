import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, runMigrations } from '../src/indexer/migrations'
import {
  SNAPSHOT_KEEP_PER_NOTE,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_MIN_INTERVAL_MS,
  getSnapshot,
  listSnapshots,
  pruneSnapshots,
  takeSnapshot,
} from '../src/indexer/snapshots'

/** Real SQLite, in memory - the retention rules are SQL, so mocking would test nothing. */
let db: Database.Database
let clock = 1_700_000_000_000
const now = (): number => clock
const advance = (ms: number): void => {
  clock += ms
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  clock = 1_700_000_000_000
})

const contents = (path: string): (string | undefined)[] =>
  listSnapshots(db, path).map((s) => getSnapshot(db, s.id)?.content)

describe('migrations', () => {
  it('applies every migration and records the version', () => {
    const fresh = new Database(':memory:')
    const { from, to } = runMigrations(fresh)
    expect(from).toBe(0)
    expect(to).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version)
  })

  it('is idempotent - running twice applies nothing new', () => {
    const { from, to } = runMigrations(db)
    expect(from).toBe(to)
  })
})

describe('version history retention', () => {
  it('stores a baseline the first time a note is seen', () => {
    // The bug this replaced: history began at the FIRST EDIT, so the content
    // before that edit was never captured.
    takeSnapshot(db, 'a.md', 'original', now)
    expect(contents('a.md')).toEqual(['original'])
  })

  it('keeps the baseline recoverable after an immediate edit', () => {
    takeSnapshot(db, 'a.md', 'original', now)
    advance(1_000) // well inside the throttle window
    takeSnapshot(db, 'a.md', 'edited', now)
    // Newest first; the original must still be there.
    expect(contents('a.md')).toEqual(['edited', 'original'])
  })

  it('never stores identical content twice', () => {
    takeSnapshot(db, 'a.md', 'same', now)
    advance(SNAPSHOT_MIN_INTERVAL_MS * 2)
    takeSnapshot(db, 'a.md', 'same', now)
    expect(listSnapshots(db, 'a.md')).toHaveLength(1)
  })

  it('collapses a burst into the newest version once a baseline exists', () => {
    takeSnapshot(db, 'a.md', 'v0', now)
    advance(SNAPSHOT_MIN_INTERVAL_MS + 1)
    takeSnapshot(db, 'a.md', 'v1', now)
    for (const text of ['v2', 'v3', 'v4']) {
      advance(200)
      takeSnapshot(db, 'a.md', text, now)
    }
    // Baseline plus one collapsed version, not five.
    expect(contents('a.md')).toEqual(['v4', 'v0'])
  })

  it('adds a new version once the throttle window has passed', () => {
    takeSnapshot(db, 'a.md', 'v0', now)
    advance(SNAPSHOT_MIN_INTERVAL_MS + 1)
    takeSnapshot(db, 'a.md', 'v1', now)
    advance(SNAPSHOT_MIN_INTERVAL_MS + 1)
    takeSnapshot(db, 'a.md', 'v2', now)
    expect(contents('a.md')).toEqual(['v2', 'v1', 'v0'])
  })

  it('keeps only the newest N per note', () => {
    for (let i = 0; i <= SNAPSHOT_KEEP_PER_NOTE + 5; i++) {
      advance(SNAPSHOT_MIN_INTERVAL_MS + 1)
      takeSnapshot(db, 'a.md', `v${i}`, now)
    }
    const kept = listSnapshots(db, 'a.md')
    expect(kept).toHaveLength(SNAPSHOT_KEEP_PER_NOTE)
    expect(getSnapshot(db, kept[0]!.id)?.content).toBe(`v${SNAPSHOT_KEEP_PER_NOTE + 5}`)
  })

  it('keeps notes separate', () => {
    takeSnapshot(db, 'a.md', 'a0', now)
    takeSnapshot(db, 'b.md', 'b0', now)
    expect(contents('a.md')).toEqual(['a0'])
    expect(contents('b.md')).toEqual(['b0'])
  })

  it('records byte length, not character count', () => {
    takeSnapshot(db, 'u.md', 'привет', now)
    // Cyrillic is two bytes per character in UTF-8.
    expect(listSnapshots(db, 'u.md')[0]?.bytes).toBe(12)
  })

  it('omits content when listing but returns it for a single fetch', () => {
    takeSnapshot(db, 'a.md', 'body', now)
    const listed = listSnapshots(db, 'a.md')[0]
    expect(listed?.content).toBeUndefined()
    expect(getSnapshot(db, listed!.id)?.content).toBe('body')
  })

  it('returns null for a version that no longer exists', () => {
    expect(getSnapshot(db, 9999)).toBeNull()
  })

  it('prunes versions older than the age limit and keeps the rest', () => {
    takeSnapshot(db, 'a.md', 'ancient', now)
    advance(SNAPSHOT_MAX_AGE_MS + 86_400_000)
    takeSnapshot(db, 'a.md', 'recent', now)
    expect(pruneSnapshots(db, now)).toBe(1)
    expect(contents('a.md')).toEqual(['recent'])
  })

  it('prunes nothing when everything is recent', () => {
    takeSnapshot(db, 'a.md', 'v0', now)
    expect(pruneSnapshots(db, now)).toBe(0)
  })
})
