import { useMemo, useSyncExternalStore } from 'react'
import type { Proposal } from '@shared/ai-access'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../app/api'

/**
 * Every suggestion main keeps - waiting, applied, discarded, gone stale - by
 * id, in one store for the whole window: the chats' cards, the Suggested
 * edits panel and a canvas's ghosts all read the same list, fetched once per
 * change rather than once per reader, so they never show one suggestion in
 * two states.
 */

let all: ReadonlyMap<string, Proposal> = new Map()
const listeners = new Set<() => void>()
let stop: (() => void) | null = null
/** Answers that arrive out of order: only the newest request's is kept. */
let asked = 0

function load(): void {
  const n = ++asked
  void api
    .invoke(IPC.aiProposals)
    .then((list) => {
      if (n !== asked) return
      all = new Map(list.map((p) => [p.id, p]))
      for (const listener of listeners) listener()
    })
    .catch(() => undefined)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // The first reader starts the one subscription to main; the last one gone ends it.
  if (stop === null) {
    stop = api.on(IPC_EVENT.aiProposalsChanged, load)
    load()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stop !== null) {
      stop()
      stop = null
    }
  }
}

export function useProposals(): ReadonlyMap<string, Proposal> {
  return useSyncExternalStore(
    subscribe,
    () => all,
    () => all,
  )
}

/** The pending suggestions for one canvas: what its ghosts show. */
export function useCanvasProposals(path: string): Proposal[] {
  const proposals = useProposals()
  return useMemo(() => [...proposals.values()].filter((p) => p.status === 'pending' && p.canvas?.path === path), [proposals, path])
}
