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

/**
 * Every file in the vault by lower-cased name, for resolving `![[name]]`.
 *
 * Obsidian embeds find a file by its NAME, anywhere in the vault, not by path -
 * so a note copied out of Obsidian says `![[diagram.png]]` and expects that to
 * work wherever the image lives. Set from the file tree whenever it changes.
 */
let byName = new Map<string, string>()

export function setVaultFiles(paths: readonly string[]): void {
  const next = new Map<string, string>()
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
    // Shortest path wins on a clash, the way Obsidian prefers the nearer file.
    const existing = next.get(name)
    if (existing === undefined || path.length < existing.length) next.set(name, path)
  }
  byName = next
}

/** A vault-relative path for `![[name]]`, or null. A path-like name is taken as written. */
export function resolveVaultFile(name: string): string | null {
  const clean = name.trim()
  if (clean.includes('/')) return clean
  return byName.get(clean.toLowerCase()) ?? null
}
