/**
 * Two-way sync between a Recto vault and an Obsidian vault: the decisions.
 *
 * Pure, no filesystem - this file decides, `engine.ts` does. The split exists
 * because this is the part that can destroy someone's notes, and it is only
 * trustworthy if every case is a test.
 *
 * A three-way comparison per file: the Recto side, the Obsidian side, and the
 * BASE - what both sides agreed on at the end of the last successful sync.
 * Without a base, "the file is missing on one side" is ambiguous: deleted
 * there, or created on the other? With one, it is not.
 *
 * The rules, in the order they protect you:
 *
 *   1. Nothing is ever deleted on the first sync. With no base, a file that
 *      exists on one side is new, full stop.
 *   2. A modification beats a deletion. Deleted on one side and edited on the
 *      other since the last sync - the edit survives, on both sides.
 *   3. Edited on both sides differently - a conflict, and both versions are
 *      kept: the more recently modified one stays at the path, the other is
 *      saved beside it with a name that says where it came from.
 *   4. A deletion that does propagate is recoverable: Recto's archive on one
 *      side, Obsidian's own `.trash` on the other (engine.ts).
 *   5. If a pass would delete a lot at once, it stops and asks (`guard`). A
 *      vault on an unplugged drive looks exactly like "every file was deleted".
 */

/** A file as seen on one side. `key` is the lower-cased path, `path` the real one. */
export type SideFile = {
  key: string
  path: string
  hash: string
  size: number
  mtime: number
}

/** What both sides agreed a file was, at the end of the last sync. */
export type BaseEntry = { hash: string }

export type SyncAction =
  | { kind: 'toObsidian'; key: string; path: string }
  | { kind: 'toRecto'; key: string; path: string }
  | { kind: 'deleteInObsidian'; key: string; path: string }
  | { kind: 'deleteInRecto'; key: string; path: string }
  | {
      kind: 'conflict'
      key: string
      /** Which side's version stays at the original path. */
      winner: 'recto' | 'obsidian'
      rectoPath: string
      obsidianPath: string
    }
  /** Same content on both sides already: only the base needs updating. */
  | { kind: 'agree'; key: string }
  /** Gone from both sides: forget it. */
  | { kind: 'forget'; key: string }

export function planSync(
  recto: ReadonlyMap<string, SideFile>,
  obsidian: ReadonlyMap<string, SideFile>,
  base: ReadonlyMap<string, BaseEntry>,
): SyncAction[] {
  const keys = new Set([...recto.keys(), ...obsidian.keys(), ...base.keys()])
  const actions: SyncAction[] = []

  for (const key of [...keys].sort()) {
    const a = recto.get(key)
    const b = obsidian.get(key)
    const was = base.get(key)

    if (a === undefined && b === undefined) {
      if (was !== undefined) actions.push({ kind: 'forget', key })
      continue
    }
    if (a !== undefined && b !== undefined && a.hash === b.hash) {
      if (was === undefined || was.hash !== a.hash) actions.push({ kind: 'agree', key })
      continue
    }

    // --- no base: first sync, or a file that has never been synced ----------
    if (was === undefined) {
      if (a !== undefined && b === undefined) actions.push({ kind: 'toObsidian', key, path: a.path })
      else if (b !== undefined && a === undefined) actions.push({ kind: 'toRecto', key, path: b.path })
      else if (a !== undefined && b !== undefined) actions.push(conflict(key, a, b))
      continue
    }

    // --- with a base: who changed? ------------------------------------------
    const rectoChanged = a === undefined || a.hash !== was.hash
    const obsidianChanged = b === undefined || b.hash !== was.hash

    if (!rectoChanged && obsidianChanged) {
      actions.push(b !== undefined ? { kind: 'toRecto', key, path: b.path } : { kind: 'deleteInRecto', key, path: a!.path })
    } else if (rectoChanged && !obsidianChanged) {
      actions.push(a !== undefined ? { kind: 'toObsidian', key, path: a.path } : { kind: 'deleteInObsidian', key, path: b!.path })
    } else if (a === undefined && b !== undefined) {
      // Deleted in Recto, edited in Obsidian: the edit wins.
      actions.push({ kind: 'toRecto', key, path: b.path })
    } else if (b === undefined && a !== undefined) {
      actions.push({ kind: 'toObsidian', key, path: a.path })
    } else if (a !== undefined && b !== undefined) {
      actions.push(conflict(key, a, b))
    }
  }
  return actions
}

function conflict(key: string, a: SideFile, b: SideFile): SyncAction {
  return {
    kind: 'conflict',
    key,
    // Ties go to Recto: an arbitrary but stable choice beats a coin flip.
    winner: b.mtime > a.mtime ? 'obsidian' : 'recto',
    rectoPath: a.path,
    obsidianPath: b.path,
  }
}

export type PlanSummary = {
  toRecto: number
  toObsidian: number
  deleteInRecto: number
  deleteInObsidian: number
  conflicts: number
}

export function summarise(actions: readonly SyncAction[]): PlanSummary {
  const summary: PlanSummary = { toRecto: 0, toObsidian: 0, deleteInRecto: 0, deleteInObsidian: 0, conflicts: 0 }
  for (const action of actions) {
    if (action.kind === 'toRecto') summary.toRecto++
    else if (action.kind === 'toObsidian') summary.toObsidian++
    else if (action.kind === 'deleteInRecto') summary.deleteInRecto++
    else if (action.kind === 'deleteInObsidian') summary.deleteInObsidian++
    else if (action.kind === 'conflict') summary.conflicts++
  }
  return summary
}

/**
 * Refuse a pass that deletes suspiciously much.
 *
 * The threshold is the larger of 20 files or a quarter of what the side had at
 * the last sync. Below that a burst of real deletions goes through; above it a
 * person has to say "yes, sync anyway". An Obsidian vault on a drive that is
 * not mounted, or a folder renamed out from under the app, trips this - which
 * is the point.
 */
export function guard(
  summary: PlanSummary,
  baseSize: number,
): { ok: true } | { ok: false; side: 'recto' | 'obsidian'; count: number } {
  const limit = Math.max(20, Math.ceil(baseSize * 0.25))
  if (summary.deleteInRecto > limit) return { ok: false, side: 'recto', count: summary.deleteInRecto }
  if (summary.deleteInObsidian > limit) return { ok: false, side: 'obsidian', count: summary.deleteInObsidian }
  return { ok: true }
}

/**
 * The name a losing conflict version is saved under.
 *
 * `Plan (Obsidian conflict 2026-09-14 10-32).md` - says where it came from and
 * when, keeps the extension so it still opens as what it is, and sorts beside
 * the original.
 */
export function conflictPath(path: string, from: 'Recto' | 'Obsidian', when: Date): string {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash + 1)
  const file = path.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}-${pad(when.getMinutes())}`
  return `${dir}${stem} (${from} conflict ${stamp})${ext}`
}

/** Paths never synced: dot-folders (`.obsidian`, `.recto`, `.git`, `.trash`) and dotfiles. */
export function ignored(relative: string): boolean {
  return relative.split('/').some((segment) => segment.startsWith('.') || segment === 'node_modules')
}
