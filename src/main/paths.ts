import fs from 'node:fs'
import path from 'node:path'

/**
 * True if `target` is inside `root` (or is `root` itself).
 *
 * Uses path.relative, NOT startsWith: `startsWith` lets "/vault-evil" pass as
 * inside "/vault". This is Cabinet finding #1 and it is a real escape.
 * Only "..", "../…" and absolute results leave: "..notes.md" is a legal name.
 */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}

/** Symlink hops followed by hand before giving up, like the OS's own ELOOP limit. */
const MAX_LINK_HOPS = 40

/**
 * Where `absolute` really is on disk, following every symlink, even when the
 * path does not exist yet.
 *
 * Create and import check the target before they `mkdir -p` it, so a plain
 * realpath would throw ENOENT on every new note. Instead: realpath the nearest
 * ancestor that exists and re-append the missing segments. A dangling symlink
 * also throws ENOENT, but writing through it would create its target, possibly
 * outside the vault - so a missing segment that is itself a link is followed.
 * Synchronous on purpose: the vault:// protocol and reveal call this sync.
 */
export function realPath(absolute: string): string {
  let existing = path.resolve(absolute)
  const missing: string[] = []
  for (let hops = 0; ;) {
    try {
      return path.join(fs.realpathSync(existing), ...missing)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    let link: string | null = null
    try {
      link = fs.readlinkSync(existing)
    } catch {
      // Not a link (or not there at all): an ordinary missing segment.
    }
    if (link !== null) {
      if (++hops > MAX_LINK_HOPS) throw new Error(`too many symlinks: ${absolute}`)
      existing = path.resolve(path.dirname(existing), link)
      continue
    }
    const parent = path.dirname(existing)
    if (parent === existing) return path.join(existing, ...missing)
    missing.unshift(path.basename(existing))
    existing = parent
  }
}

/**
 * True if `absolute` (a path inside the vault as text) really lives outside it,
 * through a symlink somewhere along the way. Anything that cannot be resolved
 * counts as outside: a check that fails must fail closed.
 */
export function leavesVault(vaultRoot: string, absolute: string): boolean {
  try {
    return !isInside(realPath(vaultRoot), realPath(absolute))
  } catch {
    return true
  }
}

/**
 * Resolve a vault-relative path to an absolute one, refusing anything that
 * escapes the vault, as text or through a symlink. Throws rather than returning
 * null so a caller can never forget to check.
 *
 * Returns the path as text under `vaultRoot`, not the realpath: callers turn it
 * back into a vault-relative path, which only works against the same root.
 * Symlinks that stay inside the vault keep working.
 */
export function resolveInVault(vaultRoot: string, relativePath: string): string {
  const abs = path.resolve(vaultRoot, relativePath)
  if (!isInside(vaultRoot, abs)) {
    throw new Error(`path escapes vault: ${relativePath}`)
  }
  if (leavesVault(vaultRoot, abs)) {
    throw new Error(`"${relativePath}" is a symlink that points outside the vault; Recto doesn't open it`)
  }
  return abs
}
