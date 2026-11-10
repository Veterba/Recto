import { useEffect, useState } from 'react'
import type { Proposal } from '@shared/ai-access'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../app/api'

/**
 * Every suggestion main keeps - waiting, applied, discarded, gone stale - by
 * id, kept up to date as they change. The chats show an answer's suggestions
 * from it, and the Suggested edits panel the ones that wait.
 */
export function useProposals(): ReadonlyMap<string, Proposal> {
  const [all, setAll] = useState<ReadonlyMap<string, Proposal>>(() => new Map())
  useEffect(() => {
    let live = true
    const load = (): void =>
      void api
        .invoke(IPC.aiProposals)
        .then((list) => {
          if (live) setAll(new Map(list.map((p) => [p.id, p])))
        })
        .catch(() => undefined)
    load()
    const off = api.on(IPC_EVENT.aiProposalsChanged, load)
    return () => {
      live = false
      off()
    }
  }, [])
  return all
}
