import { useCallback } from 'react'
import { pick, screenToWorld } from '../geometry'
import { still, zoomAt } from '../camera-motion'
import type { GraphRefs } from './use-graph-refs'

/**
 * The canvas's pointer: wheel and pinch zoom, drag to pan (with a glide on
 * release) or to tow a note, click to open one, hover to light its
 * neighbourhood.
 */
export function useGraphPointer(
  refs: GraphRefs,
  onOpenNote: (path: string) => void,
  setHovered: (label: string | null) => void,
): {
  size: () => [number, number]
  onWheel: (event: React.WheelEvent) => void
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerLeave: () => void
} {
  const { hostRef, motion, moving, state, jumpCamera, workerRef, heldIndex, targets, focusTarget, dirty } = refs

  const size = useCallback((): [number, number] => {
    const host = hostRef.current
    return [host?.clientWidth ?? 0, host?.clientHeight ?? 0]
  }, [])

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      const [width, height] = size()
      const rect = event.currentTarget.getBoundingClientRect()
      /**
       * Proportional to the scroll, not a fixed 10% per event.
       *
       * A trackpad sends dozens of tiny deltas and a wheel a few large ones; a
       * fixed step per event made the trackpad zoom in lurching jumps. Scaled
       * by the delta, both feed one continuous zoom that the camera eases
       * into. A pinch arrives as a wheel event with ctrlKey and small deltas,
       * so it gets a larger factor.
       */
      const rate = event.ctrlKey ? 0.012 : event.deltaMode === 1 ? 0.05 : 0.0025
      motion.current = zoomAt(
        motion.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * rate),
        width,
        height,
      )
      moving.current = true
    },
    [size],
  )

  /**
   * The note and everything one link away - what the veil leaves lit.
   *
   * Recomputed per hover rather than kept as an adjacency map: a hover happens
   * once per pointer *change*, and a pass over the edge list is nothing beside
   * the frame that follows it.
   */
  const around = useCallback((index: number): Set<number> | null => {
    if (index < 0) return null
    const set = new Set<number>([index])
    for (const [a, b] of state.current.edges) {
      if (a === index) set.add(b)
      else if (b === index) set.add(a)
    }
    return set
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const [width, height] = size()
      const rect = event.currentTarget.getBoundingClientRect()
      const hit = pick(state.current, event.clientX - rect.left, event.clientY - rect.top, width, height)

      // Grabbing the canvas stops any glide or zoom in progress, so the view is
      // exactly where it looks like it is when the drag begins.
      jumpCamera({ ...state.current.camera })
      const startCamera = { ...state.current.camera }
      let moved = false
      /** Recent pointer movement, for the glide on release. */
      let lastSample = { t: performance.now(), x: event.clientX, y: event.clientY }
      let velocity = { x: 0, y: 0 }

      const onMove = (move: PointerEvent): void => {
        const dx = move.clientX - event.clientX
        const dy = move.clientY - event.clientY
        // A few pixels of travel is a click with a shaky hand, not a drag.
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true

        if (hit >= 0) {
          const [wx, wy] = screenToWorld(state.current.camera, move.clientX - rect.left, move.clientY - rect.top, width, height)
          workerRef.current?.postMessage({ kind: 'drag', index: hit, x: wx, y: wy })
          // Under the cursor this frame, not next tick: the worker's answer is
          // the same point, and waiting for it is the lag.
          heldIndex.current = hit
          state.current.positions[hit * 2] = wx
          state.current.positions[hit * 2 + 1] = wy
          if (targets.current.length === state.current.positions.length) {
            targets.current[hit * 2] = wx
            targets.current[hit * 2 + 1] = wy
          }
          // Keep its neighbourhood lit for the whole gesture: the pointer is
          // over the note it is towing, but the hover test no longer runs.
          state.current.focus = around(hit)
          focusTarget.current = 1
          dirty.current = true
        } else {
          // A pan follows the pointer exactly; easing it would feel like lag.
          jumpCamera({
            ...startCamera,
            x: startCamera.x - dx / startCamera.zoom,
            y: startCamera.y - dy / startCamera.zoom,
          })
          const now = performance.now()
          const elapsed = now - lastSample.t
          if (elapsed > 0) {
            // Smoothed, so one jittery sample does not fling the graph.
            const vx = -(move.clientX - lastSample.x) / startCamera.zoom / elapsed
            const vy = -(move.clientY - lastSample.y) / startCamera.zoom / elapsed
            velocity = { x: velocity.x * 0.6 + vx * 0.4, y: velocity.y * 0.6 + vy * 0.4 }
          }
          lastSample = { t: now, x: move.clientX, y: move.clientY }
        }
      }

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (hit < 0) {
          // Let a flicked pan glide. A drag that stopped before release -
          // held still for a moment - does not.
          if (moved && performance.now() - lastSample.t < 80) {
            motion.current = { ...still(state.current.camera), velocity }
            moving.current = true
          }
          return
        }
        workerRef.current?.postMessage({ kind: 'release', index: hit })
        heldIndex.current = -1
        focusTarget.current = 0
        dirty.current = true
        if (!moved) {
          // A topic has no note behind it; hovering shows its members.
          const hitNode = state.current.nodes[hit]
          if (hitNode !== undefined && hitNode.topic !== true) onOpenNote(hitNode.path)
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [size, onOpenNote, around],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const [width, height] = size()
      const rect = event.currentTarget.getBoundingClientRect()
      const hit = pick(state.current, event.clientX - rect.left, event.clientY - rect.top, width, height)
      if (hit !== state.current.hovered) {
        state.current.hovered = hit
        const lit = around(hit)
        if (lit !== null) state.current.focus = lit
        focusTarget.current = lit === null ? 0 : 1
        dirty.current = true
        setHovered(hit < 0 ? null : (state.current.nodes[hit]?.label ?? null))
      }
    },
    [size, around],
  )

  const onPointerLeave = (): void => {
    state.current.hovered = -1
    focusTarget.current = 0
    dirty.current = true
    setHovered(null)
  }

  return { size, onWheel, onPointerDown, onPointerMove, onPointerLeave }
}
