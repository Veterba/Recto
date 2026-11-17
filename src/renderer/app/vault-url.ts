import { linkVault, resolveLinkpath, type LinkFile, type LinkVault } from '@shared/obsidian-links'
import type { FileNode } from '@shared/vault'

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
 * The vault's files, for resolving `![[name]]` the way a click on a link
 * resolves it: by Obsidian's rules, from the note the embed is in
 * (shared/obsidian-links.ts). Set from the file tree whenever it changes.
 */
let files: LinkVault = linkVault([])

export function setVaultFiles(roots: readonly FileNode[]): void {
  const out: LinkFile[] = []
  const walk = (nodes: readonly FileNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') walk(node.children ?? [])
      else out.push({ path: node.path, ctime: node.ctime ?? 0 })
    }
  }
  walk(roots)
  files = linkVault(out)
}

/** The vault path `![[target]]` in the note at `source` ('' for none) means, or null. */
export function resolveVaultFile(target: string, source = ''): string | null {
  return resolveLinkpath(target.trim(), source, files)
}
