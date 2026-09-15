import { api } from '../api'
import type { StoredRange } from '../editor/authorship'

/**
 * Authorship on disk: `.recto/authors.json`, `{ notes: { [path]: ranges } }`.
 *
 * Read-modify-write on every save rather than a cached copy, because main edits
 * the same file when a note is renamed or moved - a stale copy here would put
 * the old path back.
 */

type File = { version: 1; notes: Record<string, StoredRange[]> }

const FEATURE = 'authors'

async function read(): Promise<File> {
  const raw = (await api.invoke('state:read', FEATURE)) as Partial<File> | null
  const notes = raw !== null && typeof raw === 'object' && raw.notes !== null && typeof raw.notes === 'object' ? raw.notes : {}
  return { version: 1, notes: notes as Record<string, StoredRange[]> }
}

export async function loadAuthors(path: string): Promise<StoredRange[]> {
  const file = await read()
  const ranges = file.notes[path]
  return Array.isArray(ranges) ? ranges : []
}

const timers = new Map<string, number>()
const latest = new Map<string, StoredRange[]>()
let chain: Promise<void> = Promise.resolve()

/** Debounced per note; writes are serialised so two notes saving at once cannot drop each other. */
export function saveAuthors(path: string, ranges: StoredRange[]): void {
  latest.set(path, ranges)
  window.clearTimeout(timers.get(path))
  timers.set(
    path,
    window.setTimeout(() => {
      timers.delete(path)
      const value = latest.get(path) ?? []
      latest.delete(path)
      chain = chain.then(async () => {
        const file = await read()
        const had = path in file.notes
        if (value.length === 0) {
          if (!had) return
          delete file.notes[path]
        } else {
          file.notes[path] = value
        }
        await api.invoke('state:write', FEATURE, file)
      })
    }, 700),
  )
}

/** Write anything still waiting now, e.g. when a note closes. */
export function flushAuthors(path: string): void {
  const timer = timers.get(path)
  if (timer === undefined) return
  window.clearTimeout(timer)
  timers.delete(path)
  const value = latest.get(path) ?? []
  latest.delete(path)
  chain = chain.then(async () => {
    const file = await read()
    if (value.length === 0) delete file.notes[path]
    else file.notes[path] = value
    await api.invoke('state:write', FEATURE, file)
  })
}
