import { describe, expect, it } from 'vitest'
import { isInside, resolveInVault } from '../src/main/paths'
import { isAppUrl } from '../src/main/navigation'

describe('path containment', () => {
  it('accepts paths inside the vault', () => {
    expect(isInside('/vault', '/vault')).toBe(true)
    expect(isInside('/vault', '/vault/note.md')).toBe(true)
    expect(isInside('/vault', '/vault/deep/nested/note.md')).toBe(true)
  })

  it('rejects the sibling-prefix escape that startsWith lets through', () => {
    // "/vault-evil".startsWith("/vault") === true. This is Cabinet finding #1.
    expect('/vault-evil'.startsWith('/vault')).toBe(true)
    expect(isInside('/vault', '/vault-evil')).toBe(false)
    expect(isInside('/vault', '/vault-evil/note.md')).toBe(false)
  })

  it('rejects traversal out of the vault', () => {
    expect(isInside('/vault', '/vault/../etc/passwd')).toBe(false)
    expect(isInside('/vault', '/etc/passwd')).toBe(false)
  })

  it('resolveInVault throws rather than returning something ignorable', () => {
    expect(resolveInVault('/vault', 'a/b.md')).toBe('/vault/a/b.md')
    expect(resolveInVault('/vault', './a/../b.md')).toBe('/vault/b.md')
    expect(() => resolveInVault('/vault', '../secrets.md')).toThrow(/escapes vault/)
    expect(() => resolveInVault('/vault', '/etc/passwd')).toThrow(/escapes vault/)
  })

  it('handles unicode paths without mangling them', () => {
    expect(isInside('/vault', '/vault/Заметка.md')).toBe(true)
    expect(resolveInVault('/vault', 'заметки/день.md')).toBe('/vault/заметки/день.md')
  })
})

describe('navigation policy', () => {
  const entry = 'file:///app/out/renderer/index.html'
  const dev = 'http://localhost:5173/'

  it('allows the app navigating to itself (this is what reload is)', () => {
    // location.reload() fires will-navigate; blanket-preventing it breaks reload.
    expect(isAppUrl(entry, entry)).toBe(true)
    expect(isAppUrl('file:///app/out/renderer/index.html#x', entry)).toBe(true)
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
  })

  it('refuses navigation away from the app', () => {
    expect(isAppUrl('https://example.com', entry)).toBe(false)
    expect(isAppUrl('file:///etc/passwd', entry)).toBe(false)
    expect(isAppUrl('file:///app/out/renderer/other.html', entry)).toBe(false)
    expect(isAppUrl('http://evil.test:5173/', dev)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', entry)).toBe(false)
    expect(isAppUrl('not a url', entry)).toBe(false)
  })
})
