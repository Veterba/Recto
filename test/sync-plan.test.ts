import { describe, expect, it } from 'vitest'
import { conflictPath, guard, ignored, planSync, summarise, type BaseEntry, type SideFile } from '../src/main/sync/plan'

const file = (path: string, hash: string, mtime = 1): SideFile => ({ key: path.toLowerCase(), path, hash, size: 1, mtime })
const side = (...files: SideFile[]): Map<string, SideFile> => new Map(files.map((f) => [f.key, f]))
const base = (entries: Record<string, string>): Map<string, BaseEntry> =>
  new Map(Object.entries(entries).map(([k, hash]) => [k.toLowerCase(), { hash }]))

const kinds = (actions: ReturnType<typeof planSync>): string[] => actions.map((a) => `${a.kind}:${a.key}`)

describe('first sync (no base)', () => {
  it('copies each side to the other and deletes nothing', () => {
    const actions = planSync(side(file('a.md', '1')), side(file('b.md', '2')), new Map())
    expect(kinds(actions)).toEqual(['toObsidian:a.md', 'toRecto:b.md'])
  })

  it('records identical files without copying them', () => {
    expect(kinds(planSync(side(file('a.md', 'x')), side(file('a.md', 'x')), new Map()))).toEqual(['agree:a.md'])
  })

  /** Same path, different content, no history: nobody can say which is right. */
  it('treats the same path with different content as a conflict', () => {
    expect(kinds(planSync(side(file('a.md', '1')), side(file('a.md', '2')), new Map()))).toEqual(['conflict:a.md'])
  })
})

describe('after a sync', () => {
  const agreed = base({ 'a.md': 'v1' })

  it('does nothing when neither side changed', () => {
    expect(planSync(side(file('a.md', 'v1')), side(file('a.md', 'v1')), agreed)).toEqual([])
  })

  it('carries a Recto edit to Obsidian', () => {
    expect(kinds(planSync(side(file('a.md', 'v2')), side(file('a.md', 'v1')), agreed))).toEqual(['toObsidian:a.md'])
  })

  it('carries an Obsidian edit to Recto', () => {
    expect(kinds(planSync(side(file('a.md', 'v1')), side(file('a.md', 'v2')), agreed))).toEqual(['toRecto:a.md'])
  })

  it('carries a deletion in Obsidian to Recto', () => {
    expect(kinds(planSync(side(file('a.md', 'v1')), side(), agreed))).toEqual(['deleteInRecto:a.md'])
  })

  it('carries a deletion in Recto to Obsidian', () => {
    expect(kinds(planSync(side(), side(file('a.md', 'v1')), agreed))).toEqual(['deleteInObsidian:a.md'])
  })

  /** Rule 2: deleted on one side, edited on the other - the edit wins. */
  it('lets an Obsidian edit beat a Recto deletion', () => {
    expect(kinds(planSync(side(), side(file('a.md', 'v2')), agreed))).toEqual(['toRecto:a.md'])
  })

  it('lets a Recto edit beat an Obsidian deletion', () => {
    expect(kinds(planSync(side(file('a.md', 'v2')), side(), agreed))).toEqual(['toObsidian:a.md'])
  })

  it('makes an edit on both sides a conflict, newest at the path', () => {
    const [action] = planSync(side(file('a.md', 'r', 100)), side(file('a.md', 'o', 200)), agreed)
    expect(action).toMatchObject({ kind: 'conflict', winner: 'obsidian' })
  })

  it('agrees when both sides made the same edit', () => {
    expect(kinds(planSync(side(file('a.md', 'v2')), side(file('a.md', 'v2')), agreed))).toEqual(['agree:a.md'])
  })

  it('forgets a file deleted on both sides', () => {
    expect(kinds(planSync(side(), side(), agreed))).toEqual(['forget:a.md'])
  })
})

describe('guard', () => {
  it('lets a normal amount of deleting through', () => {
    expect(guard({ toRecto: 0, toObsidian: 0, deleteInRecto: 5, deleteInObsidian: 0, conflicts: 0 }, 400)).toEqual({ ok: true })
  })

  /** An unmounted drive looks exactly like "everything was deleted". */
  it('stops a pass that would delete most of a side', () => {
    expect(guard({ toRecto: 0, toObsidian: 0, deleteInRecto: 400, deleteInObsidian: 0, conflicts: 0 }, 418)).toEqual({
      ok: false,
      side: 'recto',
      count: 400,
    })
  })

  it('never stops for 20 or fewer, even in a tiny vault', () => {
    expect(guard({ toRecto: 0, toObsidian: 0, deleteInRecto: 0, deleteInObsidian: 20, conflicts: 0 }, 21).ok).toBe(true)
  })
})

describe('summarise', () => {
  it('counts what a pass will do', () => {
    const actions = planSync(side(file('a.md', '1'), file('c.md', 'x')), side(file('b.md', '2'), file('c.md', 'y')), new Map())
    expect(summarise(actions)).toEqual({ toRecto: 1, toObsidian: 1, deleteInRecto: 0, deleteInObsidian: 0, conflicts: 1 })
  })
})

describe('conflictPath', () => {
  it('keeps the folder and extension and says where the version came from', () => {
    expect(conflictPath('School/Plan.md', 'Obsidian', new Date(2026, 8, 14, 10, 32))).toBe(
      'School/Plan (Obsidian conflict 2026-09-14 10-32).md',
    )
  })

  it('handles a file with no extension', () => {
    expect(conflictPath('README', 'Recto', new Date(2026, 0, 2, 3, 4))).toBe('README (Recto conflict 2026-01-02 03-04)')
  })
})

describe('ignored', () => {
  it('skips both apps’ own folders and dotfiles', () => {
    for (const path of ['.obsidian/app.json', '.recto/index.db', '.trash/old.md', 'notes/.DS_Store', '.git/HEAD']) {
      expect(ignored(path)).toBe(true)
    }
  })

  it('syncs ordinary notes and attachments', () => {
    expect(ignored('School/Algebra.md')).toBe(false)
    expect(ignored('attachments/diagram.png')).toBe(false)
  })
})
