import { beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import { ensureTodayNote } from '../../../../src/renderer/features/templates/periodic-notes'
import { DEFAULT_TEMPLATE_SETTINGS, PERIODS, type Period, type TemplateSettings } from '../../../../src/shared/templates'

/**
 * "Today's note" against an in-memory vault: which note it makes, and that
 * nothing - no note, no folder - appears for a period that is off.
 */
const files = new Map<string, string>()
/** Every folder `fs:create` was asked to make a file in, with all its parents. */
const folders = new Set<string>()

beforeEach(() => {
  files.clear()
  folders.clear()
  ;(globalThis as { window?: unknown }).window = {
    api: {
      invoke: async (channel: string, ...args: string[]) => {
        if (channel === IPC.fsRead) {
          const content = files.get(args[0]!)
          return content === undefined ? { ok: false, error: 'missing' } : { ok: true, content }
        }
        if (channel === IPC.fsWrite) {
          files.set(args[0]!, args[1]!)
          return { ok: true }
        }
        if (channel === IPC.fsCreate) {
          const parts = args[0]!.split('/')
          for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
          const path = `${args[0]}/${args[1]}`
          files.set(path, '')
          return { ok: true, path }
        }
        throw new Error(`unexpected ${channel}`)
      },
      on: () => () => {},
    },
  }
})

function settings(on: readonly Period[]): TemplateSettings {
  const base = DEFAULT_TEMPLATE_SETTINGS.periodic
  const period = (p: Period): TemplateSettings['periodic'][Period] => ({ ...base[p], enabled: on.includes(p) })
  return {
    ...DEFAULT_TEMPLATE_SETTINGS,
    periodic: {
      ...base,
      folder: 'Journal',
      daily: period('daily'),
      weekly: period('weekly'),
      monthly: period('monthly'),
      yearly: period('yearly'),
    },
  }
}

/** Friday 16 October 2026: ISO week 42. */
const day = new Date(2026, 9, 16, 10, 0)

describe("today's note", () => {
  it('with no period on, makes nothing', async () => {
    expect(await ensureTodayNote(settings([]), [], day)).toBeNull()
    expect(files.size).toBe(0)
    expect(folders.size).toBe(0)
  })

  it('daily off, weekly on: makes this week and no daily folders', async () => {
    const today = await ensureTodayNote(settings(['weekly']), [], day)
    expect(today).toEqual({ period: 'weekly', result: { ok: true, path: 'Journal/2026/2026-W42.md', created: true } })
    expect([...files.keys()]).toEqual(['Journal/2026/2026-W42.md'])
    expect([...folders].sort()).toEqual(['Journal', 'Journal/2026'])
    expect(files.get('Journal/2026/2026-W42.md')).toBe('# 2026-W42\n\n')
  })

  it('makes only the note of the shortest period on, for every combination', async () => {
    for (let mask = 1; mask < 16; mask++) {
      files.clear()
      folders.clear()
      const on = PERIODS.filter((_, i) => (mask & (1 << i)) !== 0)
      const today = await ensureTodayNote(settings(on), [], day)
      expect(today?.period).toBe(on[0])
      // One note, in folders its own path needs: never a week folder without daily notes.
      expect(files.size).toBe(1)
      const made = [...files.keys()][0]!
      expect(today?.result).toEqual({ ok: true, path: made, created: true })
      expect([...folders].every((folder) => made.startsWith(`${folder}/`))).toBe(true)
      if (!on.includes('daily')) expect(made).not.toMatch(/\/W\d\d\//)
    }
  })

  it('an existing note is opened, not remade', async () => {
    files.set('Journal/2026/2026-10.md', 'written in')
    const today = await ensureTodayNote(settings(['monthly', 'yearly']), [], day)
    expect(today).toEqual({ period: 'monthly', result: { ok: true, path: 'Journal/2026/2026-10.md', created: false } })
    expect(files.get('Journal/2026/2026-10.md')).toBe('written in')
    expect(folders.size).toBe(0)
  })

  it('in the 53rd ISO week of 2026, including its days in 2027', async () => {
    expect((await ensureTodayNote(settings(['weekly']), [], new Date(2026, 11, 31)))?.result).toMatchObject({ path: 'Journal/2026/2026-W53.md' })
    expect((await ensureTodayNote(settings(['weekly']), [], new Date(2027, 0, 3)))?.result).toMatchObject({
      path: 'Journal/2026/2026-W53.md',
      created: false,
    })
  })
})
