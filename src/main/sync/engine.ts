import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  conflictPath,
  guard,
  ignored,
  planSync,
  summarise,
  type BaseEntry,
  type PlanSummary,
  type SideFile,
  type SyncAction,
} from './plan'

/**
 * Two-way sync: the part that touches files.
 *
 * No Electron here, on purpose - so the whole cycle runs in tests against real
 * temporary folders. Recto's archive is the one thing it needs from the app,
 * and it is passed in.
 *
 * One pass:
 *   1. scan both folders (hashes reused when size and mtime are unchanged)
 *   2. plan against the base from the last pass (plan.ts)
 *   3. refuse if a side's root is missing, or the plan deletes too much
 *   4. carry out each action; a failure is recorded and the pass continues
 *   5. rescan, and write the new base: a file is "agreed" only when both
 *      sides actually hold the same bytes after the pass
 *
 * Step 5 is what makes a crash, a failed copy or an edit made mid-pass safe: a
 * file that did not end up identical keeps its OLD base, so the next pass sees
 * exactly what changed and nothing is mistaken for a deletion.
 */

type Stat = { path: string; size: number; mtime: number; hash: string }

type ManifestEntry = { hash: string; recto?: Stat; obsidian?: Stat }

type Manifest = { version: 1; entries: Record<string, ManifestEntry> }

export type SyncReport = {
  at: number
  summary: PlanSummary
  /** Paths saved as conflict copies this pass. */
  conflicts: string[]
  errors: string[]
}

export type SyncOutcome =
  | { ok: true; report: SyncReport }
  | { ok: false; reason: 'missing'; side: 'recto' | 'obsidian' }
  | { ok: false; reason: 'nested' }
  | { ok: false; reason: 'guard'; side: 'recto' | 'obsidian'; count: number; summary: PlanSummary }
  | { ok: false; reason: 'error'; message: string }

export type EngineOptions = {
  rectoRoot: string
  obsidianRoot: string
  /** Where the base and the hash cache live. Outside both vaults. */
  manifestFile: string
  /** Move a Recto file into the app's archive, so a propagated deletion is recoverable. */
  archiveInRecto: (relative: string) => Promise<void>
  /** Run a pass the guard stopped, because a person said so. */
  force?: boolean
  now?: () => Date
}

const toPosix = (value: string): string => value.split(path.sep).join('/')

async function readManifest(file: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest
    if (parsed.version === 1 && typeof parsed.entries === 'object' && parsed.entries !== null) return parsed
  } catch {
    // Missing or unreadable: a first sync, which by design deletes nothing.
  }
  return { version: 1, entries: {} }
}

async function writeAtomically(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  // A dot-name in the same folder: ignored by both apps' scanners, and a rename
  // within one folder is atomic, so neither app ever reads half a file.
  const temp = path.join(path.dirname(file), `.recto-sync-${randomBytes(6).toString('hex')}`)
  await fs.writeFile(temp, data)
  await fs.rename(temp, file)
}

const hashOf = (data: Buffer): string => createHash('sha1').update(data).digest('hex')

/** Every syncable file under a root, keyed by lower-cased relative path. */
export async function scan(
  root: string,
  cached: (key: string) => Stat | undefined,
): Promise<Map<string, SideFile>> {
  const out = new Map<string, SideFile>()

  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const relative = toPosix(path.relative(root, absolute))
      if (ignored(relative)) continue
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      let stat: import('node:fs').Stats
      try {
        stat = await fs.stat(absolute)
      } catch {
        continue
      }
      const key = relative.toLowerCase()
      const previous = cached(key)
      let hash: string
      if (previous !== undefined && previous.size === stat.size && previous.mtime === stat.mtimeMs) {
        hash = previous.hash
      } else {
        try {
          hash = hashOf(await fs.readFile(absolute))
        } catch {
          continue
        }
      }
      out.set(key, { key, path: relative, hash, size: stat.size, mtime: stat.mtimeMs })
    }
  }

  await walk(root)
  return out
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/** One inside the other would sync a vault into itself, forever. */
export function nested(a: string, b: string): boolean {
  const inside = (outer: string, inner: string): boolean => {
    const rel = path.relative(path.resolve(outer), path.resolve(inner))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }
  return inside(a, b) || inside(b, a)
}

async function scanBoth(options: EngineOptions, manifest: Manifest) {
  const recto = await scan(options.rectoRoot, (key) => manifest.entries[key]?.recto)
  const obsidian = await scan(options.obsidianRoot, (key) => manifest.entries[key]?.obsidian)
  return { recto, obsidian }
}

const baseOf = (manifest: Manifest): Map<string, BaseEntry> =>
  new Map(Object.entries(manifest.entries).map(([key, entry]) => [key, { hash: entry.hash }]))

/** What a pass would do, without doing any of it. */
export async function previewSync(
  options: EngineOptions,
): Promise<{ ok: true; summary: PlanSummary } | Exclude<SyncOutcome, { ok: true }>> {
  const precheck = await check(options)
  if (precheck !== null) return precheck
  const manifest = await readManifest(options.manifestFile)
  const { recto, obsidian } = await scanBoth(options, manifest)
  return { ok: true, summary: summarise(planSync(recto, obsidian, baseOf(manifest))) }
}

async function check(options: EngineOptions): Promise<Exclude<SyncOutcome, { ok: true }> | null> {
  if (nested(options.rectoRoot, options.obsidianRoot)) return { ok: false, reason: 'nested' }
  if (!(await isDirectory(options.rectoRoot))) return { ok: false, reason: 'missing', side: 'recto' }
  if (!(await isDirectory(options.obsidianRoot))) return { ok: false, reason: 'missing', side: 'obsidian' }
  return null
}

/** Move a file into Obsidian's own `.trash`, which is where Obsidian itself puts deletions. */
async function trashInObsidian(root: string, relative: string): Promise<void> {
  const source = path.join(root, relative)
  let target = path.join(root, '.trash', relative)
  const ext = path.extname(target)
  const stem = target.slice(0, target.length - ext.length)
  for (let n = 2; await exists(target); n++) target = `${stem} ${n}${ext}`
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.rename(source, target)
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function perform(action: SyncAction, options: EngineOptions, report: SyncReport): Promise<void> {
  const { rectoRoot, obsidianRoot } = options
  switch (action.kind) {
    case 'toObsidian':
      await writeAtomically(path.join(obsidianRoot, action.path), await fs.readFile(path.join(rectoRoot, action.path)))
      return
    case 'toRecto':
      await writeAtomically(path.join(rectoRoot, action.path), await fs.readFile(path.join(obsidianRoot, action.path)))
      return
    case 'deleteInObsidian':
      await trashInObsidian(obsidianRoot, action.path)
      return
    case 'deleteInRecto':
      await options.archiveInRecto(action.path)
      return
    case 'conflict': {
      const rectoData = await fs.readFile(path.join(rectoRoot, action.rectoPath))
      const obsidianData = await fs.readFile(path.join(obsidianRoot, action.obsidianPath))
      const winnerData = action.winner === 'recto' ? rectoData : obsidianData
      const loserData = action.winner === 'recto' ? obsidianData : rectoData
      const loserPath = conflictPath(action.rectoPath, action.winner === 'recto' ? 'Obsidian' : 'Recto', options.now?.() ?? new Date())
      // Both versions end up on BOTH sides: the winner at the path, the other
      // beside it. Nothing either app had is lost.
      if (action.winner === 'recto') await writeAtomically(path.join(obsidianRoot, action.obsidianPath), winnerData)
      else await writeAtomically(path.join(rectoRoot, action.rectoPath), winnerData)
      await writeAtomically(path.join(rectoRoot, loserPath), loserData)
      await writeAtomically(path.join(obsidianRoot, loserPath), loserData)
      report.conflicts.push(loserPath)
      return
    }
    case 'agree':
    case 'forget':
      return
  }
}

export async function runSync(options: EngineOptions): Promise<SyncOutcome> {
  try {
    const precheck = await check(options)
    if (precheck !== null) return precheck

    const manifest = await readManifest(options.manifestFile)
    const before = await scanBoth(options, manifest)
    const actions = planSync(before.recto, before.obsidian, baseOf(manifest))
    const summary = summarise(actions)

    if (options.force !== true) {
      const verdict = guard(summary, Object.keys(manifest.entries).length)
      if (!verdict.ok) return { ok: false, reason: 'guard', side: verdict.side, count: verdict.count, summary }
    }

    const report: SyncReport = { at: Date.now(), summary, conflicts: [], errors: [] }
    for (const action of actions) {
      try {
        await perform(action, options, report)
      } catch (err) {
        report.errors.push(`${'path' in action ? action.path : action.key}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // --- the new base ---------------------------------------------------------
    const after = await scanBoth(options, manifest)
    const entries: Record<string, ManifestEntry> = {}
    for (const key of new Set([...after.recto.keys(), ...after.obsidian.keys()])) {
      const a = after.recto.get(key)
      const b = after.obsidian.get(key)
      if (a !== undefined && b !== undefined && a.hash === b.hash) {
        entries[key] = { hash: a.hash, recto: a, obsidian: b }
      } else if (manifest.entries[key] !== undefined) {
        // Not identical after the pass - a failed copy, or an edit made while it
        // ran. Keep the OLD base so the next pass sees what changed, instead of
        // treating the file as brand new on one side.
        entries[key] = { ...manifest.entries[key]!, ...(a ? { recto: a } : {}), ...(b ? { obsidian: b } : {}) }
      }
    }
    await writeAtomically(options.manifestFile, JSON.stringify({ version: 1, entries } satisfies Manifest))
    return { ok: true, report }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
