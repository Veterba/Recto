/**
 * What Settings and the file tree can ask of topics: list, rename, delete,
 * rebuild, preview, undo the last run, and follow a note that moved.
 */

import type { TopicInfo, TopicsPreview } from '../../shared/topics'
import { currentVault } from '../vault'
import { readTopics, saveTopics, readSettings, saveSettings } from './storage'
import {
  linkSources,
  publish,
  context,
  markEvaluated,
  tick,
  modelRoot,
  states,
  openEmbedder,
  SAMPLE_MEMBERS,
  active,
  putState,
} from './service'
import { topicLink, byName, TOPICS_PROPERTY, pending, allowed, renamePath } from './state'
import * as vaultFs from '../vault-fs'
import { sameLink, undoLast } from './runs'
import { linksIn } from '../../shared/link-property'
import { writeNote, reconcile, writeAll } from './writes'
import { quiet } from './note-cache'
import { build, membership } from './grouping'
import { modelPresent } from './model'
import { devGuarded } from '../dev-guard'
import type { StateRow } from '../../shared/embedder-protocol'
import { ask } from './embedder-client'

/** The topics, with how many notes carry each. */
export async function list(): Promise<TopicInfo[]> {
  const vault = currentVault()
  if (!vault) return []
  const state = readTopics()
  const counts = new Map<string, number>()
  const sources = await Promise.all(state.topics.map((t) => linkSources(topicLink(t.name))))
  state.topics.forEach((t, i) => counts.set(t.id, sources[i]!.length))
  return state.topics
    .filter((t) => !state.deleted.includes(t.id))
    .map((t) => ({ id: t.id, name: t.name, notes: counts.get(t.id) ?? 0 }))
    .sort((a, b) => b.notes - a.notes || a.name.localeCompare(b.name))
}

const INVALID_NAME = /[[\]|#^/\\:]/

/**
 * Rename a topic everywhere: every `[[topics/Old]]` becomes `[[topics/New]]`
 * through the link rewrite, and the topic is never renamed automatically again.
 */
export async function rename(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean === '' || INVALID_NAME.test(clean)) return { ok: false, error: 'A topic name cannot be empty or contain [ ] | # ^ / \\ :' }
  const state = readTopics()
  const topic = state.topics.find((t) => t.id === id)
  if (topic === undefined) return { ok: false, error: 'No such topic.' }
  const clash = byName(state, clean)
  if (clash !== undefined && clash.id !== id) return { ok: false, error: `There is already a topic called “${clash.name}”.` }
  const from = topicLink(topic.name)
  const to = topicLink(clean)
  // Exact: `[[topics/Old]]` only - never `[[Old]]`, a link to an ordinary note.
  await vaultFs.rewriteLinksTo(await linkSources(from), `${from}.md`, `${to}.md`, true)
  saveTopics({
    ...state,
    topics: state.topics.map((t) => (t.id === id ? { ...t, name: clean, renamedByUser: true } : t)),
    // Undoing an older run must not bring the old name back: every record of it says the new one.
    runs: state.runs.map((r) => ({
      ...r,
      changes: r.changes.map((c) =>
        c.op === 'rename' && c.topic === id ? { ...c, link: to, from: to } : sameLink(c.link, from) ? { ...c, link: to } : c,
      ),
      ...(r.restore === undefined
        ? {}
        : {
            restore: { ...r.restore, topics: r.restore.topics.map((t) => (t.id === id ? { ...t, name: clean, renamedByUser: true } : t)) },
          }),
    })),
  })
  return { ok: true }
}

/** Delete a topic: out of every note's `topics`, and never created again. */
export async function remove(id: string): Promise<void> {
  const state = readTopics()
  const topic = state.topics.find((t) => t.id === id)
  if (topic === undefined) return
  const link = topicLink(topic.name)
  const carriers = await linkSources(link)
  for (const p of carriers) {
    const read = await vaultFs.readFile(p)
    if (!read.ok) continue
    const entries = linksIn(read.content, TOPICS_PROPERTY)
    await writeNote(
      p,
      read.content,
      TOPICS_PROPERTY,
      entries.filter((e) => !sameLink(e, link)),
    )
  }
  const strip = (m: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(m)
        .map(([k, v]): [string, string[]] => [k, v.filter((x) => x !== id)])
        .filter(([, v]) => v.length > 0),
    )
  saveTopics({
    ...state,
    topics: state.topics.filter((t) => t.id !== id),
    deleted: [...new Set([...state.deleted, id])],
    deletedMembers: { ...state.deletedMembers, [id]: carriers },
    assigned: strip(state.assigned),
    owned: strip(state.owned),
  })
  publish()
}

/** "Rebuild topics": cluster again, keeping ids and names where a cluster continues an old topic. */
export async function rebuild(): Promise<void> {
  const ctx = await context(readSettings())
  const now = Date.now()
  const state = reconcile(ctx, readTopics())
  const settled = ctx.eligible.filter((p) => quiet(ctx, p, now))
  saveTopics(await build(ctx, state, settled))
  await markEvaluated(ctx, settled)
  void tick()
}

/**
 * What the next run would write, without writing: the topics it would build
 * (or has), and which notes get which.
 */
export async function preview(): Promise<TopicsPreview> {
  const vault = currentVault()
  if (!vault || !modelPresent(modelRoot())) return { notes: 0, topics: [], assignments: [] }
  if (states.size === 0) await openEmbedder(vault.path)
  const ctx = await context(readSettings())
  const now = Date.now()
  let state = reconcile(ctx, readTopics())
  const settled = ctx.eligible.filter((p) => quiet(ctx, p, now))
  if (state.builtAt === null) state = await build(ctx, state, settled)
  const members = membership(state, ctx)
  const name = (id: string): string => state.topics.find((t) => t.id === id)?.name ?? id
  return {
    notes: settled.length,
    topics: [...members.entries()]
      .filter(([id, m]) => m.size > 0 && !state.deleted.includes(id))
      .map(([id, m]) => ({ name: name(id), size: m.size, sample: [...m].slice(0, SAMPLE_MEMBERS) }))
      .sort((a, b) => b.size - a.size),
    assignments: pending(state).map((p) => ({
      path: p,
      topics: (state.assigned[p] ?? []).filter((id) => allowed(state, p, id)).map(name),
    })),
  }
}

/**
 * Settings has shown the first-run line: the next scheduled run may write.
 * Not in a dev build - opening Settings while developing is not a decision to
 * let unfinished code write to notes (see dev-guard).
 */
export function seen(): void {
  if (devGuarded()) return
  const settings = readSettings()
  if (settings.reviewedAt !== null) return
  saveSettings({ ...settings, reviewedAt: Date.now() })
  publish()
}

/** Take back everything the most recent run changed (see runs.undoLast). */
export async function undoLastRun(): Promise<number> {
  const state = readTopics()
  const run = state.runs.at(-1)
  if (run === undefined) return 0
  const texts = new Map<string, string>()
  for (const p of new Set(run.changes.map((c) => c.path))) {
    const read = await vaultFs.readFile(p)
    if (read.ok) texts.set(p, read.content)
  }
  const undone = undoLast(state, (p) => texts.get(p) ?? null)
  await writeAll(undone.writes)
  saveTopics(undone.state)
  publish()
  return undone.changes
}

/** A note moved in the app: its record moves with it. The link rewrite has already fixed the text. */
export async function moved(from: string, to: string): Promise<void> {
  saveTopics(renamePath(readTopics(), from, to))
  if (!active || states.size === 0) return
  const map = (p: string): string => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p)
  const forget: string[] = []
  const rows: (Partial<StateRow> & { path: string })[] = []
  for (const [p, st] of [...states]) {
    const np = map(p)
    if (np === p) continue
    forget.push(p)
    states.delete(p)
    rows.push({ ...st, path: np, embeddedMtime: null })
  }
  if (forget.length > 0) await ask({ kind: 'forget', paths: forget }, 'ok')
  await putState(rows)
}
