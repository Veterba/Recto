import { useCallback } from 'react'
import type { Proposal } from '@shared/ai-access'
import type { CanvasDoc } from '@shared/canvas'
import { acceptOps, rejectOps } from '@shared/canvas-ops'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import type { CanvasChange } from './canvas-change'
import { useCanvasProposals, type GhostAccept } from './components/GhostLayer'

type Accepted = ReturnType<typeof acceptOps>

/**
 * An AI's suggested changes to one canvas, as ghosts until accepted: the
 * pending proposals, and accepting or rejecting their edits. An accept is
 * one canvas edit (⌘Z takes it back); what each proposal became is told to
 * main only once that edit is written, from the canvas it was written to.
 */
export function useGhosts(
  path: string,
  docRef: { readonly current: CanvasDoc | null },
  edit: (change: CanvasChange) => Promise<boolean>,
): { proposals: Proposal[]; accept: (accepted: readonly GhostAccept[]) => Promise<void>; reject: (p: Proposal, indexes: number[] | null) => void } {
  const proposals = useCanvasProposals(path)

  const accept = useCallback(
    async (accepted: readonly GhostAccept[]): Promise<void> => {
      const shown = docRef.current
      if (shown === null) return
      const plan = accepted.flatMap(({ proposal, indexes }) => {
        const c = proposal.canvas
        if (c === undefined) return []
        return [{ id: proposal.id, c, which: indexes ?? c.states.flatMap((s, i) => (s === 'pending' ? [i] : [])) }]
      })
      // Every proposal one after the other in ONE edit. An edit each, in the
      // same moment, built each from the same canvas: Accept all kept only the last.
      const acceptAll = (d: CanvasDoc): { doc: CanvasDoc; done: Accepted[] } => {
        const done: Accepted[] = []
        let doc = d
        for (const { c, which } of plan) {
          const one = acceptOps(doc, c, which)
          done.push(one)
          doc = one.doc
        }
        return { doc, done }
      }
      const onScreen = acceptAll(shown)
      // The edit is made again to the file when it changed meanwhile, with new ids: the last made is the one written.
      let written = onScreen
      const ok = await edit((d) => {
        if (d !== shown) written = acceptAll(d)
        return d === shown ? onScreen.doc : written.doc
      })
      // Not written: nothing is settled, and the ghosts stay to be accepted again.
      if (!ok) return
      await Promise.all(plan.map(({ id }, k) => api.invoke(IPC.aiProposalCanvas, id, written.done[k]!.states, written.done[k]!.refs)))
    },
    [docRef, edit],
  )

  const reject = useCallback((p: Proposal, indexes: number[] | null) => {
    const c = p.canvas
    if (c === undefined) return
    const which = indexes ?? c.states.flatMap((s, i) => (s === 'pending' ? [i] : []))
    void api.invoke(IPC.aiProposalCanvas, p.id, rejectOps(c, which), c.refs)
  }, [])

  return { proposals, accept, reject }
}
