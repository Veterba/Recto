/**
 * Turning a vault-relative path into something an `<img>` can load.
 *
 * The renderer runs from the app bundle, so `attachments/shot.png` means
 * nothing to it - the path has to be resolved against the vault's absolute
 * location, which only the shell knows. Kept as a module-level value rather
 * than threaded through the editor, because CodeMirror widgets are constructed
 * far from any React context.
 *
 * The alternative was a custom protocol handler in main. That is the better
 * answer the moment images need to work in a packaged, sandboxed build, and
 * this is deliberately the one place that would have to change.
 */

let root = ''

export function setVaultPath(path: string): void {
  root = path
}

/** A `file://` URL for a path inside the vault, or '' if we have no vault. */
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
  // Absolute paths and real URLs are left alone: a note may legitimately point
  // at something outside the vault.
  if (/^[a-z]+:\/\//i.test(decoded) || decoded.startsWith('/')) return decoded
  const joined = `${root}/${decoded}`.replace(/\/+/g, '/')
  return `file://${joined.split('/').map(encodeURIComponent).join('/')}`
}
