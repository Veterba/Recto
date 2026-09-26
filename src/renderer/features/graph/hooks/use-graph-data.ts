import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphInfo } from '@shared/index-results'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { useNoteBus } from '../../../app/note-bus'
import { signature } from '../view-model'

/** How long after a vault change before refetching - saves arrive in bursts. */
const REFRESH_DEBOUNCE_MS = 700

/** The index's link graph, fetched once and again after vault changes settle. Null until the first answer. */
export function useGraphData(): GraphInfo | null {
  const [graph, setGraph] = useState<GraphInfo | null>(null)
  const signatureRef = useRef('')
  const { revision } = useNoteBus()

  const load = useCallback(() => {
    void api.invoke(IPC.indexGraph).then((next) => {
      // Replacing state with a structurally identical graph would tear the
      // simulation down and start it over for no visible reason.
      const sig = signature(next)
      if (sig === signatureRef.current) return
      signatureRef.current = sig
      setGraph(next)
    })
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    if (revision === 0) return
    const timer = window.setTimeout(load, REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [revision, load])

  return graph
}
