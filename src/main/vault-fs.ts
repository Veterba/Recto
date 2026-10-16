import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type { FileNode } from '../shared/vault'
import { READ_ONLY_BYTES, TOO_LARGE_BYTES, type TextFileResult } from '../shared/file-kind'
import { writeLog } from './config'
import { rewriteWikiLinks } from './link-rewrite'
import { leavesVault, resolveInVault } from './paths'
import { currentVault } from './vault'
import { notTextMessage, notTextReason } from './text-file'
import { isHidden, nameOf, nameTaken, sortNodes } from '../shared/vault'

/**
 * All vault file access. Every path arriving from the renderer goes through
 * `resolveInVault`, which throws rather than returning something a caller could
 * forget to check.
 */

function requireVault(): string {
  const vault = currentVault()
  if (!vault) throw new Error('no vault open')
  return vault.path
}

/** Vault-relative, POSIX-separated, so the renderer never sees a platform path. */
function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/** Symlinks that point outside the vault, as found by the last tree walk. */
let outsideLinks: { root: string; paths: string[] } = { root: '', paths: [] }
/** Already reported this session (vault root + path), so the notice shows each once. */
const reportedOutsideLinks = new Set<string>()

/**
 * The outside-pointing symlinks not yet reported this session. They are never
 * listed, opened or indexed; this is only so the user hears about it instead
 * of wondering where a folder went.
 */
export function takeOutsideLinks(): string[] {
  const { root, paths } = outsideLinks
  const fresh = paths.filter((p) => !reportedOutsideLinks.has(path.join(root, p)))
  for (const p of fresh) reportedOutsideLinks.add(path.join(root, p))
  return fresh
}

export function listTree(): FileNode[] {
  const root = requireVault()
  const outside: string[] = []

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

      // Dirents describe the link itself, so symlinks were never listed. Ones
      // that leave the vault are noted for the notice; ones inside stay as before.
      if (entry.isSymbolicLink()) {
        if (leavesVault(root, absolute)) outside.push(relative)
        continue
      }
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

  const tree = walk(root)
  outsideLinks = { root, paths: outside }
  return tree
}

export async function readFile(relative: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    const data = await fsp.readFile(resolveInVault(requireVault(), relative))
    // Never hand binary to the editor: decoding it is lossy, and whatever reads
    // it is one save away from writing the loss back to disk.
    const notText = notTextReason(data)
    if (notText !== null) return { ok: false, error: notTextMessage(notText, false) }
    return { ok: true, content: data.toString('utf8') }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * A file that is not a note, for the code editor. Same binary check as notes,
 * plus the size: large files open read-only, huge ones not at all - the tab
 * offers Show in Finder instead of freezing the window on a 2 GB log.
 */
export async function readText(relative: string): Promise<TextFileResult> {
  try {
    const absolute = resolveInVault(requireVault(), relative)
    const { size } = await fsp.stat(absolute)
    if (size > TOO_LARGE_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        size,
        error: `This file is ${Math.round(size / 1024 / 1024)} MB, too large to open in Recto.`,
      }
    }
    const data = await fsp.readFile(absolute)
    const notText = notTextReason(data)
    if (notText === 'binary') return { ok: false, reason: 'binary', size, error: 'This file holds binary data, not text.' }
    if (notText === 'encoding') return { ok: false, reason: 'encoding', size, error: notTextMessage(notText, false) }
    return { ok: true, content: data.toString('utf8'), size, readOnly: size > READ_ONLY_BYTES }
  } catch (err) {
    return { ok: false, reason: 'error', error: message(err) }
  }
}

/**
 * Write-then-rename, so a crash mid-write cannot truncate a note. Callers are
 * expected to have registered the path as a self-write first (see watcher).
 */
export async function writeFile(relative: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const absolute = resolveInVault(requireVault(), relative)
    const existing = await fsp.readFile(absolute).catch(() => null)
    // The last line of defence for the bug above: text is never written over a
    // file that holds binary data, whatever the renderer asks for.
    const notText = existing === null ? null : notTextReason(existing.subarray(0, 8192), true)
    if (notText !== null) return { ok: false, error: notTextMessage(notText, true) }
    const bytes = Buffer.from(content, 'utf8')
    // Nothing to write: leave the file alone. A rewrite of the same bytes
    // still moves the mtime, and the mtime is what sync compares and what the
    // topics quiet period counts from.
    if (existing !== null && existing.equals(bytes)) return { ok: true }
    // A write nobody asked for is found by its caller. Off unless asked.
    if (writeLog)
      console.error(
        '[write]',
        relative,
        existing?.length ?? 'new',
        '->',
        bytes.length,
        new Error().stack?.split('\n').slice(2, 6).join(' <- '),
      )
    const tmp = `${absolute}.tmp-${process.pid}`
    await fsp.mkdir(path.dirname(absolute), { recursive: true })
    await fsp.writeFile(tmp, bytes)
    await fsp.rename(tmp, absolute)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Every file in the vault, vault-relative: what a new file name is checked
 * against. Hidden folders (`.recto`, `.git`) and symlinks are not part of it,
 * as they are not part of the tree.
 */
function allFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) out.push(toRelative(root, absolute))
    }
  }
  walk(root)
  return out
}

/**
 * File names are unique in the whole vault, not just in their folder: links go
 * by name, so a second `Plan.md` anywhere makes `[[Plan]]` ambiguous (see
 * `nameTaken`). The message names the file that has it.
 */
function takenMessage(existing: string): string {
  return `"${nameOf(existing)}" already exists: ${existing}`
}

/**
 * Append ' 2', ' 3'... until the name is free, rather than overwriting. Free
 * means nothing at this path and, for a file, no file of that name anywhere in
 * `files`.
 */
function uniquePath(absolute: string, files: readonly string[] = []): string {
  const free = (candidate: string): boolean => !fs.existsSync(candidate) && nameTaken(path.basename(candidate), files) === null
  if (free(absolute)) return absolute
  const dir = path.dirname(absolute)
  const ext = path.extname(absolute)
  const base = path.basename(absolute, ext)
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base} ${n}${ext}`)
    if (free(candidate)) return candidate
  }
  throw new Error('could not find a free filename')
}

/**
 * Copy a file into the vault's attachments folder.
 *
 * Copied, not linked. A note that points at `/Users/you/Desktop/shot.png` is a
 * note that breaks the moment the vault moves to another machine, and "your
 * notes are a folder you can move" is the whole promise. The cost is disk
 * space, which is the right thing to spend.
 */
export async function importFile(source: string, folder: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const bare = sanitiseName(path.basename(source))
    if (bare.length === 0) return { ok: false, error: 'That file has no usable name.' }
    const target = uniquePath(resolveInVault(root, path.join(folder, bare)), allFiles(root))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(source, target)
    return { ok: true, path: toRelative(root, target) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Write bytes into the vault, under a name we choose.
 *
 * The counterpart to `importFile` for content that has no path on disk - a
 * dragged image, a pasted screenshot. Same folder, same uniquing, same
 * containment; only the source differs.
 */
export async function importData(
  name: string,
  data: Uint8Array,
  folder: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const bare = sanitiseName(name)
    if (bare.length === 0) return { ok: false, error: 'That file has no usable name.' }
    const target = uniquePath(resolveInVault(root, path.join(folder, bare)), allFiles(root))
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, data)
    return { ok: true, path: toRelative(root, target) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Make an empty file or a folder. A folder whose name is taken in its parent
 * gets a number. A file whose name is taken anywhere in the vault is refused,
 * naming the file that has it - unless `onTaken` is 'number', for names the
 * app chose itself ("Untitled.md"), which get a free number instead.
 */
export async function create(
  parentRelative: string,
  name: string,
  kind: 'file' | 'folder',
  onTaken: 'refuse' | 'number' = 'refuse',
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const bare = sanitiseName(name)
    if (bare.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    let target = resolveInVault(root, path.join(parentRelative, bare))
    if (kind === 'file') {
      const files = allFiles(root)
      if (onTaken === 'number') target = uniquePath(target, files)
      else {
        const existing = nameTaken(bare, files)
        if (existing !== null) return { ok: false, error: takenMessage(existing) }
        if (fs.existsSync(target)) return { ok: false, error: `"${bare}" already exists here.` }
      }
    } else target = uniquePath(target)
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

export async function rename(relative: string, newName: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const root = requireVault()
    const from = resolveInVault(root, relative)
    const bare = sanitiseName(newName)
    if (bare.length === 0) return { ok: false, error: 'Name cannot be empty.' }
    const to = resolveInVault(root, path.join(path.dirname(relative), bare))
    if (from === to) return { ok: true, path: relative }
    // A file's new name, type change included, must be free in the whole vault.
    if (fs.statSync(from).isFile()) {
      const existing = nameTaken(bare, allFiles(root).filter((other) => other !== relative))
      if (existing !== null) return { ok: false, error: takenMessage(existing) }
    }
    if (fs.existsSync(to)) return { ok: false, error: `"${bare}" already exists here.` }
    await fsp.rename(from, to)
    return { ok: true, path: toRelative(root, to) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

export async function move(relative: string, newParent: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
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
    // The name does not change, so only the folder it goes into can have it.
    if (fs.existsSync(to)) return { ok: false, error: takenMessage(toRelative(root, to)) }
    await fsp.rename(from, to)
    return { ok: true, path: toRelative(root, to) }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

/**
 * Rewrite `[[links]]` in a set of files so they point at a note's new path.
 *
 * Returns enough to undo it: the files touched and their previous contents.
 * Editing files the user is not looking at without an undo would be reckless.
 */
export async function rewriteLinksTo(
  sources: readonly string[],
  oldPath: string,
  newPath: string,
  /** Only links that spell out the whole path - see `rewriteWikiLinks`. */
  exact = false,
): Promise<{ changed: { path: string; before: string }[]; links: number }> {
  const root = requireVault()
  const changed: { path: string; before: string }[] = []
  let links = 0

  for (const source of sources) {
    let absolute: string
    try {
      absolute = resolveInVault(root, source)
    } catch {
      continue
    }
    let before: string
    try {
      before = await fsp.readFile(absolute, 'utf8')
    } catch {
      continue
    }

    const result = rewriteWikiLinks(before, oldPath, newPath, exact)
    if (result.count === 0 || result.text === before) continue

    await fsp.writeFile(absolute, result.text, 'utf8')
    changed.push({ path: source, before })
    links += result.count
  }

  return { changed, links }
}

/** Put back the contents captured by `rewriteLinksTo`. */
export async function restoreContents(entries: readonly { path: string; before: string }[]): Promise<number> {
  const root = requireVault()
  let restored = 0
  for (const entry of entries) {
    try {
      await fsp.writeFile(resolveInVault(root, entry.path), entry.before, 'utf8')
      restored++
    } catch {
      // The file has since been deleted; nothing to put back.
    }
  }
  return restored
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
function sanitiseName(name: string): string {
  return name.normalize('NFC').replace(ILLEGAL_IN_NAME, '').replace(/^\.+/, '').trim().slice(0, 255)
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
