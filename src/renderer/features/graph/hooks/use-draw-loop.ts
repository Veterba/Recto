import { useEffect } from 'react'
import { draw } from '../renderer'
import { anyVisible, fit } from '../geometry'
import { readPalette } from '../palette'
import { step } from '../camera-motion'
import type { GraphRefs } from './use-graph-refs'

/** Below this width the bar tightens up. */
const SLIDERS_MIN_WIDTH = 470

/**
 * The draw loop: one requestAnimationFrame chain for the view's life, easing
 * positions, the hover veil and the camera, and drawing only when something
 * changed. Also sizes the canvas to its host and reports whether there is room
 * for the sliders.
 */
export function useDrawLoop(refs: GraphRefs, setRoomy: (roomy: boolean) => void, setFrameMs: (ms: number) => void): void {
  const { canvasRef, hostRef, dirty, state, jumpCamera, framePositions, easing, targets, heldIndex, focusTarget, moving, motion } = refs

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (canvas === null || host === null) return

    const context = canvas.getContext('2d', { alpha: true })
    if (context === null) return

    let palette = readPalette()
    let running = true
    let frame = 0

    const resize = (): void => {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(host.clientWidth * ratio))
      canvas.height = Math.max(1, Math.floor(host.clientHeight * ratio))
      canvas.style.width = `${host.clientWidth}px`
      canvas.style.height = `${host.clientHeight}px`
      // Setting width/height resets the context, so the DPR transform has to be
      // reapplied every time - a blurry graph on a retina screen is what
      // forgetting this looks like.
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      palette = readPalette()
      dirty.current = true
      setRoomy(host.clientWidth >= SLIDERS_MIN_WIDTH)

      // Shrinking the panel keeps the camera from the larger size, which can
      // leave the whole graph outside the frame - restoring a maximised panel
      // showed an empty canvas. Re-frame only when nothing at all is visible.
      if (state.current.nodes.length > 0 && !anyVisible(state.current, host.clientWidth, host.clientHeight)) {
        jumpCamera(fit(framePositions(), state.current.nodes.length, host.clientWidth, host.clientHeight))
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let last = performance.now()

    const loop = (now: number): void => {
      if (!running) return
      const dt = now - last
      last = now
      if (easing.current) {
        // Frame-rate independent: 63% of the remaining distance every 150ms,
        // whatever the frame rate, so it looks the same on any display. Slower
        // than it needs to be for correctness, on purpose - a rebuild or a new
        // layout should read as the graph moving, not as a cut.
        const k = 1 - Math.exp(-dt / 150)
        const drawn = state.current.positions
        const target = targets.current
        let far = false
        if (drawn.length === target.length) {
          const held = heldIndex.current
          for (let i = 0; i < drawn.length; i++) {
            if (held >= 0 && (i === held * 2 || i === held * 2 + 1)) {
              drawn[i] = target[i]!
              continue
            }
            const delta = target[i]! - drawn[i]!
            if (delta > 0.05 || delta < -0.05) {
              drawn[i] = drawn[i]! + delta * k
              far = true
            } else {
              drawn[i] = target[i]!
            }
          }
        }
        easing.current = far
        dirty.current = true
      }
      const fade = state.current.focusFade ?? 0
      if (fade !== focusTarget.current) {
        const k = reduced ? 1 : 1 - Math.exp(-dt / 90)
        const next = fade + (focusTarget.current - fade) * k
        const settled = Math.abs(focusTarget.current - next) < 0.01
        state.current.focusFade = settled ? focusTarget.current : next
        if (settled && focusTarget.current === 0) state.current.focus = null
        dirty.current = true
      }
      if (moving.current) {
        const next = step(state.current.camera, motion.current, dt, host.clientWidth, host.clientHeight, reduced)
        state.current.camera = next.camera
        motion.current = next.motion
        moving.current = next.moving
        dirty.current = true
      }
      // Signals move on their own, so the frame is never idle while they run.
      if (!reduced && state.current.look?.edge.pulses === true && state.current.nodes.length > 0) {
        state.current.time = now
        dirty.current = true
      }
      if (dirty.current) {
        dirty.current = false
        const ms = draw(context, state.current, palette, host.clientWidth, host.clientHeight)
        // Measured, not assumed: this number is what decides whether Canvas 2D
        // was the right call over WebGL.
        if (frame % 30 === 0) setFrameMs(Math.round(ms * 100) / 100)
        frame++
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)

    return () => {
      running = false
      observer.disconnect()
    }
  }, [])
}
