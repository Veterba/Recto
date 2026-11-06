import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_ACCESS_STATE } from '../../src/shared/ai-access'
import { makePdf } from '../fixtures/make-pdf'

/**
 * read_file: the AI reads any file in the vault it may see - a PDF's text by
 * pages, a text file in parts, a canvas, a picture's size - and is told
 * plainly what it cannot read. A file in an excluded folder is "no file".
 */

let root = ''
const state: Record<string, unknown> = {}
vi.mock('electron', () => ({ app: { on: () => undefined, getPath: () => os.tmpdir() }, shell: {} }))
vi.mock('../../src/main/vault', () => ({ currentVault: () => ({ path: root, name: 'v' }) }))
vi.mock('../../src/main/state', () => ({ readState: (feature: string) => state[feature] ?? null, writeState: () => ({ ok: true }) }))

const { buildScope } = await import('../../src/main/vault-tools/scope')
const { readAnyFile } = await import('../../src/main/vault-tools/files')

const put = (relative: string, content: string | Buffer): void => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}
/** What the model is given: the data block's fields. */
const read = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const [block] = await readAnyFile(buildScope('test'), args)
  return (block as { kind: 'data'; data: Record<string, unknown> }).data
}
/** A PNG's first bytes: signature, then the header chunk with its width and height. */
const png = (width: number, height: number): Buffer => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-read-file-'))
  state[AI_ACCESS_STATE] = { excluded: ['Private'] }
  put('attachments/Treatise.pdf', makePdf(['Of knowledge and probability', 'Of the passions', 'Of morals']))
  put('Data/plan.json', `{"steps": ["${'x'.repeat(30_000)}"]}`)
  put('attachments/Garden.png', png(640, 480))
  put('Recto/Canvas/Plan.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'Sow in March' }], edges: [] }))
  put('Private/Taxes.pdf', makePdf(['secret']))
  put('Old/report.pdf', makePdf(['old']))
  put('New/report.pdf', makePdf(['new']))
  put('attachments/Budget.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0xff, 0xfe]))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('read_file', () => {
  it('a PDF: its text, page by page, by name; and only the pages asked for', async () => {
    const all = await read({ file: 'Treatise.pdf' })
    expect(all).toMatchObject({ path: 'attachments/Treatise.pdf', kind: 'pdf' })
    expect(all['text']).toContain('PDF, 3 pages; pages 1-3')
    expect(all['text']).toContain('--- page 2 ---\nOf the passions')
    const some = await read({ file: 'attachments/Treatise.pdf', pages: '3' })
    expect(some['text']).toContain('Of morals')
    expect(some['text']).not.toContain('Of the passions')
  })

  it('a long text file comes in parts, with where to go on', async () => {
    const first = await read({ file: 'Data/plan.json' })
    expect(first['next_offset']).toBe(24_000)
    const rest = await read({ file: 'Data/plan.json', offset: 24_000 })
    expect(rest['next_offset']).toBeUndefined()
  })

  it('a canvas as its cards; a picture as its size', async () => {
    expect((await read({ file: 'Plan.canvas' }))['text']).toContain('- Card: Sow in March')
    expect(await read({ file: 'Garden.png' })).toMatchObject({ kind: 'image', pixels: '640 × 480' })
  })

  it('a file in an excluded folder is no file; a name two files have is asked about; what cannot be read is said', async () => {
    await expect(read({ file: 'Private/Taxes.pdf' })).rejects.toThrow('No file')
    await expect(read({ file: 'Taxes.pdf' })).rejects.toThrow('No file')
    await expect(read({ file: 'report.pdf' })).rejects.toThrow('2 files are called “report.pdf”: New/report.pdf, Old/report.pdf')
    expect((await read({ file: 'New/report.pdf' }))['text']).toContain('new')
    await expect(read({ file: 'Budget.xlsx' })).rejects.toThrow('is a file Recto cannot read yet (XLSX, 1 KB)')
  })
})
