import { describe, expect, it } from 'vitest'
import { removeField, renameField, setField, withBody } from '../../src/shared/frontmatter'
import { isCrlf, keepLineEndings } from '../../src/shared/line-endings'
import { rewriteWikiLinks } from '../../src/main/link-rewrite'

/** A note synced from Windows is CRLF; an edit to one key or one link must not rewrite every line. */

const CRLF_NOTE = '---\r\ntags: [a]\r\nstatus: draft\r\n---\r\n# Plan\r\n\r\nSee [[Old]].\r\n'

describe('line endings', () => {
  it('a file is CRLF only when every break is', () => {
    expect(isCrlf('a\r\nb\r\n')).toBe(true)
    expect(isCrlf('a\r\nb\n')).toBe(false)
    expect(isCrlf('a\nb')).toBe(false)
    expect(isCrlf('one line')).toBe(false)
  })

  it('keepLineEndings hands the edit LF and gives CRLF back', () => {
    expect(keepLineEndings('a\r\nb', (lf) => `${lf}\nc`)).toBe('a\r\nb\r\nc')
    expect(keepLineEndings('a\nb', (lf) => `${lf}\nc`)).toBe('a\nb\nc')
  })

  it('frontmatter edits keep a CRLF note CRLF', () => {
    expect(setField(CRLF_NOTE, 'due', '2026-11-01')).toBe(
      '---\r\ntags: [a]\r\nstatus: draft\r\ndue: 2026-11-01\r\n---\r\n# Plan\r\n\r\nSee [[Old]].\r\n',
    )
    expect(removeField(CRLF_NOTE, 'status')).toBe('---\r\ntags: [a]\r\n---\r\n# Plan\r\n\r\nSee [[Old]].\r\n')
    expect(renameField(CRLF_NOTE, 'status', 'state')).toBe('---\r\ntags: [a]\r\nstate: draft\r\n---\r\n# Plan\r\n\r\nSee [[Old]].\r\n')
    expect(withBody(CRLF_NOTE, '# New\n')).toBe('---\r\ntags: [a]\r\nstatus: draft\r\n---\r\n# New\r\n')
  })

  it('a link rewrite keeps a CRLF note CRLF', () => {
    const result = rewriteWikiLinks(CRLF_NOTE, 'Old.md', 'New.md')
    expect(result.count).toBe(1)
    expect(result.text).toBe(CRLF_NOTE.replace('[[Old]]', '[[New]]'))
  })
})
