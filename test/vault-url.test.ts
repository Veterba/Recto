import { describe, expect, it } from 'vitest'
import { hasVault, setVaultPath, vaultFileUrl } from '../src/renderer/core/vault-url'

/**
 * Image URLs.
 *
 * The rule that matters: a vault-relative path becomes a `recto-file://` URL,
 * never a `file://` one. `file://` is what made every image in the app render
 * as a broken glyph - Chromium refuses a local-resource load from the dev
 * server's origin and treats it as a cross-directory read from a packaged
 * build's own.
 */
describe('vaultFileUrl', () => {
  it('is empty until a vault is open', () => {
    setVaultPath('')
    expect(hasVault()).toBe(false)
    expect(vaultFileUrl('attachments/a.png')).toBe('')
  })

  it('maps a vault-relative path onto the custom scheme', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('attachments/a.png')).toBe('recto-file://vault/attachments/a.png')
  })

  it('encodes each segment, not the separators', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('my notes/a b.png')).toBe('recto-file://vault/my%20notes/a%20b.png')
  })

  it('survives a path that is already encoded', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('my%20notes/a.png')).toBe('recto-file://vault/my%20notes/a.png')
  })

  it('leaves a real URL alone', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('drops a leading ./ rather than making it a path segment', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('./a.png')).toBe('recto-file://vault/a.png')
  })

  /**
   * Traversal is NOT rejected here, and that is deliberate: the renderer is not
   * the trust boundary. `recto-file` is a standard scheme, so the URL parser
   * collapses `..` before the request is even made, and main re-checks
   * containment on what arrives - including the `%2e%2e` spelling that survives
   * normalisation. A check that only runs in the renderer is one an attacker
   * skips by not using the renderer.
   */
  it('leaves traversal to the URL parser and to main', () => {
    setVaultPath('/Users/x/vault')
    expect(vaultFileUrl('../../.ssh/id_rsa')).toBe('recto-file://vault/../../.ssh/id_rsa')
  })
})
