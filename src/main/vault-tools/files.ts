import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileKind } from '../../shared/file-kind'
import type { ResultBlock } from '../../shared/vault-tools'
import { resolveInVault } from '../paths'
import * as vaultFs from '../vault-fs'
import { canvasContext } from './canvas-context'
import { readNote, ToolError, type Scope } from './scope'

/**
 * read_file: any file in the vault the AI may see, read as far as it can be -
 * a PDF's text by pages, a text or code file's text, a canvas as its cards,
 * notes, files and arrows, a note as itself, a picture as what it is (its
 * size; the picture itself is not sent from here). Always cut to a budget,
 * and always said where it stopped, so the next call can go on.
 */

type Args = Record<string, unknown>

const data = (value: unknown): ResultBlock => ({ kind: 'data', data: value })

/** About 6,000 tokens of text per call. */
const BUDGET_CHARS = 24_000

const kb = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** Pages "3" or "2-5" (1-based, inclusive) of `count`, or all of them. */
function pagesOf(spec: unknown, count: number): { from: number; to: number } {
  if (typeof spec !== 'string' || spec.trim() === '') return { from: 1, to: count }
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(spec)
  if (m === null) throw new ToolError(`“${spec}” is not pages: give one page ("3") or a range ("2-5").`)
  const from = Math.max(1, Number(m[1]))
  const to = Math.min(count, Number(m[2] ?? m[1]))
  if (from > count) throw new ToolError(`The PDF has ${count} page${count === 1 ? '' : 's'}.`)
  return { from, to: Math.max(from, to) }
}

/** A PDF's text, page by page, as far as the budget goes. */
async function pdfText(absolute: string, pages: unknown): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const bytes = new Uint8Array(await fsp.readFile(absolute))
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0 })
  const doc = await task.promise
  try {
    const { from, to } = pagesOf(pages, doc.numPages)
    const parts: string[] = []
    let used = 0
    let last = from - 1
    for (let n = from; n <= to; n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim()
      const block = `--- page ${n} ---\n${text === '' ? '(no text on this page: it may be a scan or a picture)' : text}`
      if (used + block.length > BUDGET_CHARS && parts.length > 0) break
      parts.push(block.length > BUDGET_CHARS ? `${block.slice(0, BUDGET_CHARS)}…` : block)
      used += block.length
      last = n
    }
    const more = last < to ? `\n\n(Stopped at page ${last} of ${doc.numPages}: ask for pages "${last + 1}-${to}" to go on.)` : ''
    return `PDF, ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}; pages ${from}-${last}:\n\n${parts.join('\n\n')}${more}`
  } finally {
    await task.destroy()
  }
}

/** A picture's pixel size, read from its header: PNG, GIF and JPEG; null for others. */
function pictureSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length > 10 && bytes.toString('ascii', 0, 3) === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (at + 9 < bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!
      const length = bytes.readUInt16BE(at + 2)
      // A start-of-frame marker holds the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
      at += 2 + length
    }
  }
  return null
}

/** Pictures sent to a model: at most this many pixels on the long side - more costs tokens, not sight. */
const SEND_PIXELS = 1568
/** And at most this many bytes, as the providers take them. */
const SEND_BYTES = 3_500_000

const MIME: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/**
 * A picture as a model is sent it: made smaller (as a JPEG) when it is large,
 * with Electron's image tools; as it is when it is small enough already, or
 * when those tools are not there (the tests). Null: too large to send.
 */
async function forTheModel(bytes: Buffer, p: string): Promise<{ mime: string; data: string } | null> {
  const mime = MIME[path.posix.extname(p).slice(1).toLowerCase()]
  try {
    const { nativeImage } = await import('electron')
    const image = nativeImage.createFromBuffer(bytes)
    if (!image.isEmpty()) {
      const { width, height } = image.getSize()
      const scale = Math.min(1, SEND_PIXELS / Math.max(width, height))
      if (scale < 1 || bytes.length > SEND_BYTES || mime === undefined) {
        const jpeg = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }).toJPEG(82)
        if (jpeg.length <= SEND_BYTES) return { mime: 'image/jpeg', data: jpeg.toString('base64') }
      }
    }
  } catch {
    // No Electron image tools here: the picture as it is, if it may go.
  }
  return mime !== undefined && bytes.length <= SEND_BYTES ? { mime, data: bytes.toString('base64') } : null
}

export async function readAnyFile(scope: Scope, a: Args): Promise<ResultBlock[]> {
  const p = scope.needFile(String(a['file']))
  const absolute = resolveInVault(scope.vault, p)
  const { size } = await fsp.stat(absolute)
  const name = path.posix.basename(p)
  const kind = fileKind(p)
  const head = { path: p, name, kind, size: kb(size) }

  if (kind === 'note') {
    const text = await readNote(p)
    return [data({ ...head, text: text.length > BUDGET_CHARS ? `${text.slice(0, BUDGET_CHARS)}…` : text })]
  }
  if (kind === 'canvas') {
    const context = await canvasContext(scope, p, [], BUDGET_CHARS / 4)
    if (context === null) throw new ToolError(`“${name}” could not be read.`)
    return [data({ ...head, text: context.text })]
  }
  if (kind === 'pdf') {
    const text = await pdfText(absolute, a['pages']).catch((err: unknown) => {
      if (err instanceof ToolError) throw err
      throw new ToolError(`“${name}” could not be read as a PDF: ${err instanceof Error ? err.message : String(err)}`)
    })
    return [data({ ...head, text })]
  }
  if (kind === 'image' && !p.toLowerCase().endsWith('.svg')) {
    const bytes = await fsp.readFile(absolute)
    const dims = pictureSize(bytes)
    const seen = await forTheModel(bytes, p)
    return [
      data({
        ...head,
        ...(dims === null ? {} : { pixels: `${dims.width} × ${dims.height}` }),
        text:
          seen === null
            ? 'A picture too large to send. Its name, size and where it is linked or placed may say what it is.'
            : 'The picture itself goes with this answer: look at it. (A model that cannot see pictures gets only this text.)',
      }),
      ...(seen === null ? [] : [{ kind: 'image' as const, path: p, ...seen }]),
    ]
  }
  // Anything else: text if it is text, from `offset` on, as far as the budget goes.
  const read = await vaultFs.readText(p)
  if (read.ok) {
    const offset = Math.max(0, Number(a['offset'] ?? 0) || 0)
    const text = read.content.slice(offset, offset + BUDGET_CHARS)
    const next = offset + BUDGET_CHARS < read.content.length ? offset + BUDGET_CHARS : null
    return [data({ ...head, text, ...(next === null ? {} : { next_offset: next }) })]
  }
  throw new ToolError(`“${name}” is a file Recto cannot read yet (${path.posix.extname(p).slice(1).toUpperCase() || 'binary'}, ${kb(size)}).`)
}
