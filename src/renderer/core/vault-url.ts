/**
 * Turning a vault-relative path into something an `<img>` can load.
 *
 * The renderer runs from the app bundle, so `attachments/shot.png` means
 * nothing to it - the path has to be resolved against the vault's absolute
 * location, which only the shell knows.
 *
 * It resolves to `recto-file://vault/...`, not `file://`. A `file://` URL is
 * refused outright from the dev server's `http://localhost` origin and treated
 * as a cross-directory read from a packaged build's own `file://` origin, which
 * is why images rendered as a broken glyph everywhere. The custom scheme is
 * handled in main, where every path goes through the vault containment check.
 */

let root = ''

export function setVaultPath(path: string): void {
  root = path
}

/** True once a vault is open; before that there is nothing to resolve against. */
export const hasVault = (): boolean => root !== ''

/** A loadable URL for a path inside the vault, or '' if we have no vault. */
export function vaultFileUrl(relative: string): string {
  if (root === '') return ''
  const decoded = (() => {
    try {
      return decodeURI(relative)
    } catch {
      // A path with a stray '%' is not encoded; use it as written.
      return relative
    }
  })()
  // Real URLs are left alone: a note may legitimately point at something on the
  // web, and an absolute local path is not ours to serve.
  if (/^[a-z]+:\/\//i.test(decoded)) return decoded
  if (decoded.startsWith('/')) return `file://${decoded}`
  const clean = decoded.replace(/^\.\//, '').replace(/\/+/g, '/')
  return `recto-file://vault/${clean.split('/').map(encodeURIComponent).join('/')}`
}
