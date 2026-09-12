import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { VAULT_STATE_DIR, type FileNode } from '../shared/ipc-contract'
import { resolveInVault } from './paths'
import { currentVault } from './vault'

/**
 * All vault file access. Every path arriving from the renderer goes through
 * `resolveInVault`, which throws rather than returning something a caller could
 * forget to check.
 */

/** Names never shown in the tree or watched. */
const HIDDEN = new Set([VAULT_STATE_DIR, '.git', '.DS_Store', 'node_modules', '.trash'])

const isHidden = (name: string): boolean => HIDDEN.has(name) || name.startsWith('.')

function requireVault(): string {
  const vault = currentVault()
  if (!vault) throw new Error('no vault open')
  return vault.path
}

/** Vault-relative, POSIX-separated, so the renderer never sees a platform path. */
function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

export function listTree(): FileNode[] {
  const root = requireVault()

  const walk = (dir: string): FileNode[] => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return [] // unreadable subtree: skip it rather than failing the whole tree
    }

    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (isHidden(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      const relative = toRelative(root, absolute)

      if (entry.isDirectory()) {
        nodes.push({ path: relative, name: entry.name, kind: 'folder', children: walk(absolute) })
      } else if (entry.isFile()) {
        let mtime = 0
        let size = 0
        try {
          const stat = fs.statSync(absolute)
          mtime = stat.mtimeMs
          size = stat.size
        } catch {
          continue // vanished between readdir and stat
        }
        nodes.push({ path: relative, name: entry.name, kind: 'file', mtime, size })
      }
    }
    return sortNodes(nodes)
  }

  return walk(root)
}

/** Folders first, then files, each alphabetical and numeric-aware. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

export async function readFile(
  relative: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    const content = await fsp.readFile(resolveInVault(requireVault(), relative), 'utf8')
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Write-then-rename, so a crash mid-write cannot truncate a note. Callers are
 * expected to have registered the path as a self-write first (see watcher).
 */
export async function writeFile(relative: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const absolute = resolveInVault(requireVault(), relative)
    const tmp = `${absolute}.tmp-${process.pid}`
    await fsp.mkdir(path.dirname(absolute), { recursive: true })
    await fsp.writeFile(tmp, content, 'utf8')
    await fsp.rename(tmp, absolute)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/** Append ' 2', ' 3'... until the name is free, rather than overwriting. */
function uniquePath(absolute: string): string {
  if (!fs.existsSync(absolute)) return absolute
  const dir = path.dirname(absolute)
  const ext = path.extname(absolute)
  const base = path.basename(absolute, ext)
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base} ${n}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error('could not find a free filename')
}

export async function create(
  parentRelative: string,
  name: string,
  kind: 'file' | 'folder',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const bare = sanitiseName(name)
    if (bare.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    const target = uniquePath(resolveInVault(root, path.join(parentRelative, bare)))
    if (kind === 'folder') {
      await fsp.mkdir(target, { recursive: true })
    } else {
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
    }
    return { ok: true, path: toRelative(root, target) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

export async function rename(
  relative: string,
  newName: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const from = resolveInVault(root, relative)
    const bare = sanitiseName(newName)
    if (bare.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    const to = resolveInVault(root, path.join(path.dirname(relative), bare))
    if (from === to) return { ok: true, path: relative }
    if (fs.existsSync(to)) return { ok: false, error: `"${bare}" already exists here.` }
    await fsp.rename(from, to)
    return { ok: true, path: toRelative(root, to) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

export async function move(
  relative: string,
  newParent: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const from = resolveInVault(root, relative)
    const to = resolveInVault(root, path.join(newParent, path.basename(relative)))
    if (from === to) return { ok: true, path: relative }
    // Moving a folder inside itself would detach the subtree from the vault.
    const rel = path.relative(from, to)
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { ok: false, error: 'Cannot move a folder into itself.' }
    }
    if (fs.existsSync(to)) return { ok: false, error: `"${path.basename(relative)}" already exists there.` }
    await fsp.rename(from, to)
    return { ok: true, path: toRelative(root, to) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Delete to the OS trash, not `unlink`. Recoverable outside the app matters
 * more than it sounds when the app owns years of someone's writing.
 */
export async function trash(relative: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await shell.trashItem(resolveInVault(requireVault(), relative))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

export function reveal(relative: string): { ok: boolean } {
  try {
    shell.showItemInFolder(resolveInVault(requireVault(), relative))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** Characters no filesystem will accept in a name, plus control codes. */
const ILLEGAL_IN_NAME = new RegExp('[/\\\\:*?"<>|\\u0000-\\u001f]', 'g')

/**
 * Strip path separators and characters the filesystem refuses, but keep
 * Unicode intact - Cabinet's ASCII-only slug rule destroys any non-Latin title
 * (finding #2), and there is no reason a note cannot be called `Заметка.md`.
 */
export function sanitiseName(name: string): string {
  return name
    .normalize('NFC')
    .replace(ILLEGAL_IN_NAME, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255)
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
