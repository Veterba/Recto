import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '../../src/shared/templates'
import { formatLink, linkVault, OBSIDIAN_DEFAULTS } from '../../src/shared/obsidian-links'

/**
 * Names follow Obsidian: a name must be free only in its own folder, in any
 * case and Unicode form - the same name in another folder is allowed, and
 * links tell the two apart (docs/dev/obsidian-link-rules.md). Every way the
 * app makes or renames a file goes through main's `create`, `rename`, `move`
 * or import, so each is driven here against real files - and cards and
 * periodic notes through their renderer code, with `window.api` wired to the
 * same main functions.
 */

let root = ''
vi.mock('electron', () => ({ shell: {}, app: { on: () => undefined, getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const vaultFs = await import('../../src/main/vault-fs')
const { createBoard, createCard } = await import('../../src/renderer/features/boards/create-card')
const { ensurePeriodicNote } = await import('../../src/renderer/features/templates/periodic-notes')

const put = (relative: string, content = ''): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
const exists = (relative: string): boolean => fs.existsSync(path.join(root, relative))
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')

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
        if (channel === IPC.linksFormat)
          return formatLink(args[0] as string, args[1] as string, linkVault(vaultFs.vaultFiles().map((p) => ({ path: p, ctime: 0 }))), OBSIDIAN_DEFAULTS, args[2] as object)
        if (channel === IPC.fsSameNamed) return vaultFs.sameNamed(args[0] as string)
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
  it('allows a note whose name another folder has, in any case', async () => {
    expect(await vaultFs.create('', 'Plan.md', 'file')).toEqual({ ok: true, path: 'Plan.md' })
    expect(await vaultFs.create('Other', 'plan.MD', 'file')).toEqual({ ok: true, path: 'Other/plan.MD' })
    expect(exists('Projects/Plan.md')).toBe(true)
  })

  it('refuses the name in the same folder, in any case', async () => {
    expect(await vaultFs.create('Projects', 'Plan.md', 'file')).toEqual({ ok: false, error: '“Plan.md” is already in this folder.' })
    expect(await vaultFs.create('Projects', 'PLAN.md', 'file')).toMatchObject({ ok: false })
  })

  it('lets a file share a note’s base name, or another type’s', async () => {
    expect(await vaultFs.create('Projects', 'Plan.pdf', 'file')).toEqual({ ok: true, path: 'Projects/Plan.pdf' })
    expect(await vaultFs.create('Projects', 'Plan.txt', 'file')).toEqual({ ok: true, path: 'Projects/Plan.txt' })
  })

  it('compares names in one Unicode form, within the folder', async () => {
    put('Notes/Café.md'.normalize('NFD'))
    expect(await vaultFs.create('Notes', 'Café.md'.normalize('NFC'), 'file')).toMatchObject({ ok: false })
    expect(await vaultFs.create('', 'Café.md'.normalize('NFC'), 'file')).toMatchObject({ ok: true })
  })

  it('numbers a name the app chose only past its own folder', async () => {
    put('Untitled.md')
    put('Untitled 2.md')
    put('Inbox/Untitled 3.md')
    expect(await vaultFs.create('', 'Untitled.md', 'file', 'number')).toEqual({ ok: true, path: 'Untitled 3.md' })
  })

  it('still numbers a folder taken in its parent', async () => {
    expect(await vaultFs.create('', 'Projects', 'folder')).toEqual({ ok: true, path: 'Projects 2' })
  })
})

describe('rename', () => {
  it('allows a note name another folder has', async () => {
    put('Inbox/Draft.md')
    expect(await vaultFs.rename('Inbox/Draft.md', 'PLAN.md')).toEqual({ ok: true, path: 'Inbox/PLAN.md' })
  })

  it('refuses a name taken in the same folder, and keeps the file', async () => {
    put('Projects/Draft.md')
    expect(await vaultFs.rename('Projects/Draft.md', 'plan.md')).toEqual({ ok: false, error: '“plan.md” is already in this folder.' })
    expect(exists('Projects/Draft.md')).toBe(true)
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
    expect(await vaultFs.move('Inbox/Plan.md', 'Projects')).toEqual({ ok: false, error: '“Plan.md” is already in that folder: Projects/Plan.md' })
    expect(exists('Inbox/Plan.md')).toBe(true)
  })

  it('moves a file whose name only another folder has', async () => {
    put('Inbox/Plan.md')
    expect(await vaultFs.move('Inbox/Plan.md', 'Archive')).toEqual({ ok: true, path: 'Archive/Plan.md' })
  })
})

describe('dropped and pasted files', () => {
  it('keep a name another folder has, and are numbered only in their own', async () => {
    expect(await vaultFs.importData('Report.pdf', new Uint8Array([1]), 'attachments')).toEqual({ ok: true, path: 'attachments/Report.pdf' })
    expect(await vaultFs.importData('Report.pdf', new Uint8Array([1]), 'attachments')).toEqual({ ok: true, path: 'attachments/Report 2.pdf' })
  })
})

describe('card creation', () => {
  it('makes a card named like a note in another folder', async () => {
    expect(await createCard('Recto/Boards/B/B.md', 'Plan')).toMatchObject({ ok: true })
    expect(read('Projects/Plan.md')).toBe('# Plan')
  })

  it('numbers the sidebar’s "New task" past its own folder only', async () => {
    put('Inbox/New task.md')
    put('Recto/Boards/B/New task.md')
    expect(await createCard('Recto/Boards/B/B.md', 'New task', 'number')).toEqual({ ok: true, path: 'Recto/Boards/B/New task 2.md' })
  })
})

describe('periodic notes', () => {
  const settings: TemplateSettings = {
    ...DEFAULT_TEMPLATE_SETTINGS,
    periodic: { ...DEFAULT_TEMPLATE_SETTINGS.periodic, folder: 'Journal' },
  }
  /** Friday 16 October 2026. */
  const day = new Date(2026, 9, 16, 10, 0)

  it('makes the day’s note in its folder even when another folder has the name, and leaves that one alone', async () => {
    put('Old/2026-10-16.md', '# old')
    const result = await ensurePeriodicNote('daily', settings, day)
    expect(result).toMatchObject({ ok: true, path: 'Journal/2026/10/W42/2026-10-16.md' })
    expect(read('Old/2026-10-16.md')).toBe('# old')
  })
})

describe('only \\ / : are refused, as in Obsidian; a name is never changed', () => {
  it('a new note, from the tree or a link, is refused and nothing is made', async () => {
    expect(await vaultFs.create('', 'Basil/Soil.md', 'file')).toEqual({ ok: false, error: 'File name cannot contain any of the following characters: \\ / :' })
    expect(await vaultFs.create('Projects', 'a:b.md', 'file')).toEqual({ ok: false, error: 'File name cannot contain any of the following characters: \\ / :' })
    expect(exists('BasilSoil.md') || exists('Basil Soil.md') || exists('Basil/Soil.md')).toBe(false)
  })

  it('a rename in the tree is refused and the note keeps its name', async () => {
    expect(await vaultFs.rename('Projects/Plan.md', 'Plan/B.md')).toEqual({ ok: false, error: 'File name cannot contain any of the following characters: \\ / :' })
    expect(exists('Projects/Plan.md')).toBe(true)
  })

  it('a new board is refused, by name, before anything is asked of main', async () => {
    expect(await createBoard('Basil/Soil')).toEqual({ ok: false, error: 'File name cannot contain any of the following characters: \\ / :' })
    expect(exists('Recto')).toBe(false)
    // Links will not find it - warned in the name field - but Obsidian allows it, so Recto does.
    expect(await createBoard('Plan [draft]')).toMatchObject({ ok: true })
  })
})
