/** The vault as the processes share it: its folders, its tree, and what changes in it. */

export const VAULT_STATE_DIR = '.recto'

export type VaultInfo = {
  /** Absolute path. Main-process side only ever; renderer treats it as opaque. */
  path: string
  /** Basename, for display. */
  name: string
}

/** Why the app is showing the first-run screen instead of a vault. */
export type StartupState =
  { kind: 'needs-vault'; reason: 'first-run' | 'missing' | 'unreadable'; lastPath?: string } | { kind: 'ready'; vault: VaultInfo }

/**
 * Where pasted, dropped and inserted images go, at the vault root.
 *
 * Hidden from the Data tree - it is the app's storage for images you put in
 * notes, not a folder you file things into - and shown in Settings → Vault.
 */
export const ATTACHMENTS_FOLDER = 'attachments'

export type RecentVault = { path: string; name: string; available: boolean }

export type OpenVaultResult =
  { ok: true; vault: VaultInfo; scaffolded: boolean } | { ok: false; error: string } | { ok: false; cancelled: true }

/**
 * One JSON file per feature inside `.recto/`, named by feature id.
 * Human-editable, individually deletable, diffable in git - Obsidian's pattern.
 * The id is a bare name: no slashes, no dots, no traversal.
 */
export type StateFeature = string

/** A node in the vault tree. Paths are vault-relative, POSIX-separated. */
export type FileNode = {
  /** Vault-relative path, e.g. 'work/nordicsync.md'. '' is the root. */
  path: string
  name: string
  kind: 'file' | 'folder'
  /** Present on folders only. */
  children?: FileNode[]
  /** Present on files only; used to decide whether a reindex is needed. */
  mtime?: number
  size?: number
}

/** What the watcher reports. One event per path, already debounced by chokidar. */
export type VaultChange =
  | { type: 'add' | 'change' | 'unlink'; path: string; mtime?: number; size?: number }
  | { type: 'addDir' | 'unlinkDir'; path: string }
  | { type: 'ready' }

/** What a rename did to other notes, so the UI can report and offer undo. */
export type RenameOutcome = {
  ok: true
  path: string
  /** Files whose links were rewritten, and how many links in total. */
  rewrittenFiles: number
  rewrittenLinks: number
  /** Present when something was rewritten; pass to `links:undo-rename`. */
  undoId?: string
}

/** Names never shown in the tree, watched or indexed. Anything starting with a dot is hidden too. */
const HIDDEN = new Set([VAULT_STATE_DIR, '.git', '.DS_Store', 'node_modules', '.trash'])

export const isHidden = (name: string): boolean => HIDDEN.has(name) || name.startsWith('.')

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then files, each alphabetical and numeric-aware. Returns a new array. */
export function sortNodes(nodes: readonly FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

/** The folder part of a vault path: 'a/b/c.md' -> 'a/b', 'c.md' -> ''. */
export const parentOf = (path: string): string => {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** The last segment of a vault path: 'a/b/c.md' -> 'c.md'. */
export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
