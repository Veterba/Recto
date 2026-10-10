import { describe, expect, it } from 'vitest'
import { extensionOf, fileKind } from '../../src/shared/file-kind'

describe('file kinds', () => {
  it('only .md is a note', () => {
    expect(fileKind('a/Note.md')).toBe('note')
    expect(fileKind('a/Note.MD')).toBe('note')
    expect(fileKind('a/readme.markdown')).toBe('code')
  })

  it('text-like files go to the code editor, including names without an extension', () => {
    for (const p of [
      'd.json',
      'd.jsonl',
      't.csv',
      't.tsv',
      'c.yaml',
      'c.toml',
      'n.txt',
      'x.log',
      's.ts',
      'p.py',
      'r.sh',
      'q.sql',
      'i.html',
      'Makefile',
    ]) {
      expect(fileKind(p), p).toBe('code')
    }
  })

  it('images and PDFs are previewed; unknown extensions are probed later', () => {
    expect(fileKind('attachments/shot.PNG')).toBe('image')
    expect(fileKind('paper.pdf')).toBe('pdf')
    expect(fileKind('archive.zip')).toBe('other')
    expect(fileKind('notes.weird')).toBe('other')
  })

  it('reads the extension from the last dot of the name only', () => {
    expect(extensionOf('a.b/c')).toBe('')
    expect(extensionOf('x/y.tar.gz')).toBe('gz')
  })
})
