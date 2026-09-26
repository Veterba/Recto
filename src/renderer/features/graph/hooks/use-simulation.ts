import { useEffect } from 'react'
import { fit } from '../geometry'
import type { Tunables, WorkerResponse } from '../protocol'
import type { GraphLook } from '../look'
import { treeEdgeIndices, type GraphLayout } from '../layout'
import type { GraphViewModel } from '../view-model'
import type { GraphRefs } from './use-graph-refs'

/**
 * The physics worker: started for each new graph with the surviving nodes'
 * positions carried over, told about setting changes by message, and its
 * positions copied into the refs the draw loop reads.
 */
export function useSimulation(
  refs: GraphRefs,
  view: GraphViewModel,
  { tunables, layout, look }: { tunables: Tunables; layout: GraphLayout; look: GraphLook },
  setSettling: (settling: boolean) => void,
): void {
  const { state, dirty, workerRef, fitted, targets, hostRef, refitOnSettle, glideCamera, framePositions, easing, sentLayout } = refs

  useEffect(() => {
    if (view.nodes.length === 0) {
      state.current = { ...state.current, nodes: [], edges: [], positions: new Float32Array(0) }
      dirty.current = true
      return
    }

    // Carry surviving nodes' positions across the rebuild. `state.current` still
    // holds the PREVIOUS layout at this point, which is the whole trick: without
    // it, every save that touches a link re-scatters the graph and the picture
    // the user had learned is gone.
    const previous = new Map<string, [number, number]>()
    state.current.nodes.forEach((node, i) => {
      previous.set(node.path, [state.current.positions[i * 2] ?? Number.NaN, state.current.positions[i * 2 + 1] ?? Number.NaN])
    })

    const seed = new Float32Array(view.nodes.length * 2).fill(Number.NaN)
    let carried = 0
    view.nodes.forEach((node, i) => {
      const at = previous.get(node.path)
      if (at === undefined) return
      seed[i * 2] = at[0]
      seed[i * 2 + 1] = at[1]
      carried++
    })
    const mostlyCarried = carried / view.nodes.length > 0.5

    const worker = new Worker(new URL('../simulation.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    setSettling(true)
    // Only re-frame a graph that is genuinely new; re-fitting on every rebuild
    // would yank the camera away from wherever the user had put it.
    fitted.current = mostlyCarried

    state.current = {
      ...state.current,
      nodes: view.nodes,
      edges: view.edges,
      autoEdges: new Set(view.auto),
      positions: new Float32Array(seed),
    }
    targets.current = new Float32Array(seed)

    worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const message = event.data
      if (message.kind === 'error') {
        console.error(`Graph layout failed: ${message.message}`)
        return
      }
      if (message.kind === 'settled') {
        setSettling(false)
        // A layout change travels further than the early fit can predict, so
        // the frame is settled again once the nodes have arrived.
        const host = hostRef.current
        if (refitOnSettle.current && host !== null) {
          refitOnSettle.current = false
          glideCamera(fit(framePositions(), view.nodes.length, host.clientWidth, host.clientHeight))
        }
        return
      }
      // Copy out, then hand the buffer straight back. The renderer draws from
      // its own array every frame, so it cannot keep the transferred one - and
      // returning it is what lets the worker reuse a single allocation instead
      // of producing a new Float32Array on every tick.
      if (targets.current.length === message.positions.length) targets.current.set(message.positions)
      else targets.current = new Float32Array(message.positions)
      // A node that has no drawn position yet starts where it is, or it would
      // fly in from the origin.
      const drawn = state.current.positions
      if (drawn.length !== targets.current.length) {
        state.current.positions = new Float32Array(targets.current)
      } else {
        for (let i = 0; i < drawn.length; i++) if (!Number.isFinite(drawn[i]!)) drawn[i] = targets.current[i]!
      }
      easing.current = true
      dirty.current = true

      // Fit once the layout has spread out. Fitting on tick one frames the seed
      // circle rather than the graph.
      if (!fitted.current && message.alpha < 0.7) {
        const host = hostRef.current
        if (host !== null) {
          // Glides into frame rather than cutting: the graph visibly settles
          // into view, the way Obsidian's does.
          glideCamera(fit(framePositions(), view.nodes.length, host.clientWidth, host.clientHeight))
          fitted.current = true
        }
      }

      worker.postMessage({ positions: message.positions }, [message.positions.buffer])
    }

    sentLayout.current = JSON.stringify(layout)
    worker.postMessage(
      {
        kind: 'start',
        count: view.nodes.length,
        edges: view.edges,
        auto: view.auto,
        tunables,
        seed,
        layout,
        groups: view.groups,
        sizing: { size: look.node.size, growth: look.node.growth },
      },
      [seed.buffer],
    )

    return () => {
      worker.postMessage({ kind: 'stop' })
      worker.terminate()
      workerRef.current = null
    }
    // `tunables`, `layout` and `look` deliberately excluded: changing them sends
    // a message rather than rebuilding the simulation from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  useEffect(() => {
    workerRef.current?.postMessage({ kind: 'tunables', tunables })
    // A different link distance means a differently sized layout. Without a
    // re-frame, raising it walks the whole graph off the edge of the viewport
    // and the only way back is the fit button.
    fitted.current = false
  }, [tunables])

  // A new shape is a new frame: refit once the nodes have travelled there.
  // Compared by value against what the worker already has, so reading the saved
  // settings back - an equal layout in a new object - does not shake the graph.
  useEffect(() => {
    if (sentLayout.current === JSON.stringify(layout)) return
    sentLayout.current = JSON.stringify(layout)
    if (workerRef.current === null) return
    workerRef.current.postMessage({ kind: 'layout', layout })
    fitted.current = false
    refitOnSettle.current = true
    setSettling(true)
  }, [layout])

  useEffect(() => {
    workerRef.current?.postMessage({ kind: 'sizing', sizing: { size: look.node.size, growth: look.node.growth } })
  }, [look.node.size, look.node.growth])

  useEffect(() => {
    state.current.look = look
    dirty.current = true
  }, [look])

  // Which links are the tree's own, for drawing a tree layout as a tree.
  useEffect(() => {
    const isTree = layout.mode === 'tree'
    state.current.treeEdges = isTree ? treeEdgeIndices(view.nodes.length, view.edges) : null
    state.current.treeDirection = isTree ? layout.direction : null
    state.current.bundle = layout.mode === 'circle'
    dirty.current = true
  }, [layout.mode, layout.direction, view])
}
