import path from 'node:path'

/**
 * True if `target` is inside `root` (or is `root` itself).
 *
 * Uses path.relative, NOT startsWith: `startsWith` lets "/vault-evil" pass as
 * inside "/vault". This is Cabinet finding #1 and it is a real escape.
 */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Resolve a vault-relative path to an absolute one, refusing anything that
 * escapes the vault. Throws rather than returning null so a caller can never
 * forget to check.
 */
export function resolveInVault(vaultRoot: string, relativePath: string): string {
  const abs = path.resolve(vaultRoot, relativePath)
  if (!isInside(vaultRoot, abs)) {
    throw new Error(`path escapes vault: ${relativePath}`)
  }
  return abs
}
