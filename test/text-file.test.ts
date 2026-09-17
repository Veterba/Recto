import { describe, expect, it } from 'vitest'
import { looksBinary, notTextMessage, notTextReason } from '../src/main/text-file'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const text = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('looksBinary', () => {
  it('treats a PNG as binary', () => {
    expect(looksBinary(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d))).toBe(true)
  })

  it('treats invalid UTF-8 without NULs as binary', () => {
    expect(looksBinary(bytes(0x41, 0xff, 0xfe, 0x42))).toBe(true)
  })

  it('reads notes in any script as text', () => {
    expect(looksBinary(text('# Заметка\n\n- пункт — ok ✓ 日本語 🧠\r\n'))).toBe(false)
    expect(looksBinary(text(''))).toBe(false)
  })

  it('does not call text binary when a character is cut at the sniff boundary', () => {
    const long = text(`${'a'.repeat(8191)}ж and more`)
    expect(looksBinary(long)).toBe(false)
  })

  /**
   * The write guard reads exactly the first 8192 bytes, so `data.length > 8192`
   * is false and nothing tells the decoder more text follows. A note with a
   * two-byte character across that boundary was then refused on save.
   */
  it('accepts a cut-off character when told the data is only the start of a file', () => {
    const cut = text(`${'a'.repeat(8191)}ж`).subarray(0, 8192)
    expect(looksBinary(cut)).toBe(true)
    expect(looksBinary(cut, true)).toBe(false)
  })
})

describe('the 8 KB boundary can never refuse a real note again', () => {
  /**
   * The bug that broke saving one note: the write guard reads exactly 8192
   * bytes, and a multi-byte character straddling that edge looked like a
   * damaged file. Every alignment is checked, not just the one that broke.
   */
  it('accepts a note whatever falls across the sniff boundary', () => {
    for (const filler of [8185, 8186, 8187, 8188, 8189, 8190, 8191, 8192]) {
      for (const char of ['ж', '—', '🧠', 'é']) {
        const whole = new TextEncoder().encode(`${'a'.repeat(filler)}${char}${'b'.repeat(200)}`)
        // What the write guard sees: the first 8192 bytes and nothing more.
        expect(looksBinary(whole.subarray(0, 8192), true)).toBe(false)
        // What the reader sees: the whole file.
        expect(looksBinary(whole)).toBe(false)
      }
    }
  })

  it('still refuses a real image and a UTF-16 file, and says which', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
    expect(notTextReason(png)).toBe('binary')
    // UTF-16 LE "Hi" with a BOM: no NULs in the first two bytes, invalid UTF-8.
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    expect(notTextReason(utf16)).toBe('binary')
    expect(notTextReason(new Uint8Array([0x41, 0xff, 0xfe, 0x42]))).toBe('encoding')
    expect(notTextMessage('encoding', true)).toContain('Not saved')
    expect(notTextMessage('binary', false)).toContain('binary data')
  })
})
