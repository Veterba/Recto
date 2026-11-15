import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** "Open with app" on a vault file: a document opens in its app; nothing that would run a program does. */

let root = ''
const opened: string[] = []
vi.mock('electron', () => ({
  shell: {
    openPath: async (p: string) => {
      opened.push(p)
      return ''
    },
  },
  app: { on: () => undefined, getPath: () => os.tmpdir() },
}))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))

const { openWithApp } = await import('../../src/main/vault-fs')

const put = (relative: string, mode = 0o644): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), 'x', { mode })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-open-'))
  opened.length = 0
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('Open with app', () => {
  it('opens a document in its app', async () => {
    put('attachments/Report.docx')
    expect(await openWithApp('attachments/Report.docx')).toEqual({ ok: true })
    expect(opened).toEqual([path.join(root, 'attachments/Report.docx')])
  })

  it('never a script, an app, an installer, a link that runs something, or a file marked executable', async () => {
    for (const p of ['Run me.command', 'Tool.app/Contents/x', 'setup.pkg', 'go.sh', 'Do.workflow', 'here.fileloc']) put(`attachments/${p}`)
    put('attachments/plain-name', 0o755)
    for (const p of ['Run me.command', 'Tool.app', 'setup.pkg', 'go.sh', 'Do.workflow', 'here.fileloc', 'plain-name'])
      expect(await openWithApp(`attachments/${p}`), p).toEqual({ ok: false })
    expect(opened).toEqual([])
  })
})
