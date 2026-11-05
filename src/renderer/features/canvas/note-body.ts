import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { noteIndexChanged } from '../../app/note-bus'

/**
 * A note's body typed into on a canvas, written to the note: its frontmatter
 * kept as it is on disk, the write held back until typing pauses, the latest
 * text for each note the one that goes.
 */

const PAUSE_MS = 600
const waiting = new Map<string, { body: string; timer: number }>()

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/

export function writeNoteBody(path: string, body: string): void {
  const before = waiting.get(path)
  if (before !== undefined) window.clearTimeout(before.timer)
  const timer = window.setTimeout(() => void flush(path), PAUSE_MS)
  waiting.set(path, { body, timer })
}

async function flush(path: string): Promise<void> {
  const next = waiting.get(path)
  waiting.delete(path)
  if (next === undefined) return
  const read = await api.invoke(IPC.fsRead, path)
  if (!read.ok) return
  const head = FRONTMATTER.exec(read.content)?.[0] ?? ''
  const text = head + next.body
  if (text === read.content) return
  const written = await api.invoke(IPC.fsWrite, path, text)
  if (written.ok) noteIndexChanged()
}
