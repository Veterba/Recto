import { describe, expect, it } from 'vitest'
import { looksBinary } from '../src/main/text-file'

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
})
