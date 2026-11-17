import { describe, expect, it } from 'vitest'
import { hasVault, resolveVaultFile, setVaultFiles, setVaultPath, vaultFileUrl } from '../../../src/renderer/app/vault-url'
import type { FileNode } from '../../../src/shared/vault'

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

describe('an embed finds its file as a link does', () => {
  const file = (path: string, ctime = 0): FileNode => ({ path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'file', ctime })
  const folder = (path: string, children: FileNode[]): FileNode => ({ path, name: path, kind: 'folder', children })
  setVaultFiles([folder('Work', [file('Work/x.md'), folder('Work/img', [file('Work/img/a.png'), file('Work/img/sub/b.png')])]), folder('Z', [file('Z/a.png')])])

  it('the file near the note it is in comes first, as Obsidian has it', () => {
    expect(resolveVaultFile('a.png', 'Work/x.md')).toBe('Work/img/a.png')
    expect(resolveVaultFile('a.png', 'Other.md')).toBe('Z/a.png')
  })

  it('a partial or relative path finds the file, any case', () => {
    expect(resolveVaultFile('sub/B.png', 'Work/x.md')).toBe('Work/img/sub/b.png')
    expect(resolveVaultFile('./img/a.png', 'Work/x.md')).toBe('Work/img/a.png')
    expect(resolveVaultFile('missing.png', 'Work/x.md')).toBeNull()
  })
})
