import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '../../src/shared/templates'

/**
 * File names are unique in the whole vault: a note by its name (links are
 * `[[Note name]]`), any other file by its name with the extension. Plan.md and
 * Plan.pdf may share a base name; two Plan.md, or two Plan.pdf, may not, in
 * any folders, in any case. Every way the app makes or renames a file goes
 * through main's `create`, `rename`, `move` or import, so each is driven here
 * against real files - and cards and periodic notes through their renderer
 * code, with `window.api` wired to the same main functions.
 */

let root = ''
vi.mock('electron', () => ({ shell: {}, app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const vaultFs = await import('../../src/main/vault-fs')
const { createCard } = await import('../../src/renderer/features/boards/create-card')
const { ensurePeriodicNote } = await import('../../src/renderer/features/templates/periodic-notes')

const put = (relative: string, content = ''): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const exists = (relative: string): boolean => fs.existsSync(path.join(root, relative))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-unique-'))
  put('Projects/Plan.md', '# Plan')
  put('Archive/Report.pdf', '%PDF')
  ;(globalThis as { window?: unknown }).window = {
    api: {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === IPC.fsCreate) return vaultFs.create(...(args as Parameters<typeof vaultFs.create>))
        if (channel === IPC.fsRead) return vaultFs.readFile(args[0] as string)
        if (channel === IPC.fsWrite) return vaultFs.writeFile(args[0] as string, args[1] as string)
        if (channel === IPC.fsTrash) return { ok: true }
        if (channel === IPC.indexResolveLink) return null
        if (channel === IPC.indexBoard) return []
        throw new Error(`unexpected ${channel}`)
      },
      on: () => () => undefined,
    },
  }
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('new note and new file', () => {
  it('refuses a note whose name is taken in another folder, in any case, naming the file', async () => {
    expect(await vaultFs.create('', 'Plan.md', 'file')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    expect(await vaultFs.create('Other', 'plan.MD', 'file')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    expect(exists('Plan.md')).toBe(false)
  })

  it('refuses the name in the same folder too', async () => {
    expect(await vaultFs.create('Projects', 'Plan.md', 'file')).toMatchObject({ ok: false, error: expect.stringContaining('Projects/Plan.md') })
  })

  it('lets a file share a note’s base name, or another type’s', async () => {
    expect(await vaultFs.create('', 'Plan.pdf', 'file')).toEqual({ ok: true, path: 'Plan.pdf' })
    expect(await vaultFs.create('Projects', 'Plan.txt', 'file')).toEqual({ ok: true, path: 'Projects/Plan.txt' })
    expect(await vaultFs.create('', 'Report.md', 'file')).toEqual({ ok: true, path: 'Report.md' })
  })

  it('refuses a file with the same name and extension anywhere', async () => {
    expect(await vaultFs.create('', 'report.pdf', 'file')).toEqual({ ok: false, error: '"Report.pdf" already exists: Archive/Report.pdf' })
  })

  it('compares names in one Unicode form', async () => {
    put('Notes/Café.md'.normalize('NFD'))
    expect(await vaultFs.create('', 'Café.md'.normalize('NFC'), 'file')).toMatchObject({ ok: false })
  })

  it('does not count hidden machine data', async () => {
    put('.recto/evals/Plan.json')
    expect(await vaultFs.create('', 'Plan.json', 'file')).toEqual({ ok: true, path: 'Plan.json' })
  })

  it('numbers a name the app chose past every folder that has it', async () => {
    put('Untitled.md')
    put('Inbox/Untitled 2.md')
    expect(await vaultFs.create('', 'Untitled.md', 'file', 'number')).toEqual({ ok: true, path: 'Untitled 3.md' })
  })

  it('still numbers a folder taken in its parent', async () => {
    expect(await vaultFs.create('', 'Projects', 'folder')).toEqual({ ok: true, path: 'Projects 2' })
  })
})

describe('rename', () => {
  it('refuses a note name taken in another folder, naming the file', async () => {
    put('Inbox/Draft.md')
    expect(await vaultFs.rename('Inbox/Draft.md', 'PLAN.md')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    expect(exists('Inbox/Draft.md')).toBe(true)
  })

  it('refuses a type change onto a name taken elsewhere', async () => {
    put('Inbox/Plan.txt')
    expect(await vaultFs.rename('Inbox/Plan.txt', 'Plan.md')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    put('Inbox/Report.md')
    expect(await vaultFs.rename('Inbox/Report.md', 'Report.pdf')).toEqual({ ok: false, error: '"Report.pdf" already exists: Archive/Report.pdf' })
  })

  it('allows a type change that only shares the base name', async () => {
    expect(await vaultFs.rename('Projects/Plan.md', 'Plan.pdf')).toEqual({ ok: true, path: 'Projects/Plan.pdf' })
  })

  it('does not count the file being renamed', async () => {
    expect(await vaultFs.rename('Projects/Plan.md', 'Plan.md')).toEqual({ ok: true, path: 'Projects/Plan.md' })
  })
})

describe('move between folders', () => {
  it('refuses a folder that already has the name, naming the file', async () => {
    put('Inbox/Plan.md')
    expect(await vaultFs.move('Inbox/Plan.md', 'Projects')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    expect(exists('Inbox/Plan.md')).toBe(true)
  })

  it('moves a uniquely named file', async () => {
    expect(await vaultFs.move('Projects/Plan.md', 'Archive')).toEqual({ ok: true, path: 'Archive/Plan.md' })
  })
})

describe('dropped and pasted files', () => {
  it('number a name taken in another folder', async () => {
    put('attachments/x.txt')
    expect(await vaultFs.importData('Report.pdf', new Uint8Array([1]), 'attachments')).toEqual({ ok: true, path: 'attachments/Report 2.pdf' })
  })
})

describe('card creation', () => {
  it('refuses a card named like a note in another folder, naming it', async () => {
    expect(await createCard('b', 'todo', 'Plan')).toEqual({ ok: false, error: '"Plan.md" already exists: Projects/Plan.md' })
    expect(exists('tasks/Plan.md')).toBe(false)
  })

  it('numbers the sidebar’s "New task"', async () => {
    put('Inbox/New task.md')
    expect(await createCard('b', 'todo', 'New task', { onTaken: 'number' })).toEqual({ ok: true, path: 'tasks/New task 2.md' })
  })
})

describe('periodic notes', () => {
  const settings: TemplateSettings = {
    ...DEFAULT_TEMPLATE_SETTINGS,
    periodic: { ...DEFAULT_TEMPLATE_SETTINGS.periodic, folder: 'Journal' },
  }
  /** Friday 16 October 2026. */
  const day = new Date(2026, 9, 16, 10, 0)

  it('does not make a note whose name is taken elsewhere, even when the list of notes is behind', async () => {
    put('Old/2026-10-16.md', '# old')
    const result = await ensurePeriodicNote('daily', settings, [], day)
    expect(result).toMatchObject({ ok: false, error: '"2026-10-16.md" already exists: Old/2026-10-16.md' })
    expect(fs.readFileSync(path.join(root, 'Old/2026-10-16.md'), 'utf8')).toBe('# old')
  })
})
