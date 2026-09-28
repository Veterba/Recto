import { type Scene, createScene } from '../scene'
import { useEffect } from 'react'
import { readFlags } from '../scene-flags'
import type { HeroLine } from '../scene-text'
import { SLIDE_MS, ease } from '../slide'
import { META_INK, RULE_INK, layoutRules, loadFaces } from '../hero-text'
import { readPalette, type Palette } from '../scene-palette'

/** The home palette the theme on screen asks for, from its `--home-*` tokens. */
function themePalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  return readPalette((token) => style.getPropertyValue(token), { meta: META_INK, rule: RULE_INK })
}

/** The one frame loop: the WebGL scene behind both pages, the text it composites, the slide between pages, and the pointer river - created when the overlay mounts, torn down when it closes. */
export function useHomeScene({
  canvasRef,
  dragOffsetRef,
  heroRef,
  measureBlocks,
  mounted,
  rasterRef,
  reduced,
  reveal,
  sceneRef,
  trackRef,
  tweenRef,
  windowRef,
}: {
  canvasRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<HTMLCanvasElement | null>
  dragOffsetRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<number | null>
  heroRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<HTMLDivElement | null>
  measureBlocks: () => void
  mounted: boolean
  rasterRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<(() => void) | null>
  reduced: boolean
  reveal: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<number>
  sceneRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<Scene | null>
  trackRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<HTMLDivElement | null>
  tweenRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<{
    from: number
    to: number
    at: number
  } | null>
  windowRef: import('/Users/veterba/Documents/workplace/code/Recto/node_modules/@types/react/index').RefObject<HTMLDivElement | null>
}): void {
  // --- the one frame loop -------------------------------------------------

  useEffect(() => {
    if (!mounted) return
    const canvas = canvasRef.current
    const host = windowRef.current
    const hero = heroRef.current
    if (canvas === null || host === null) return

    const flags = readFlags()
    let palette = themePalette()
    let scene = createScene(canvas, flags, reduced, palette)
    sceneRef.current = scene

    /*
     * Follow the theme while open. It lives in two places - `data-theme` on
     * the root when chosen, the OS's scheme when on system - and the accent
     * the dark ramp ends on is an inline style on the root, so all three are
     * watched. Most root style changes are something else (the sidebar's
     * width, say): only a palette that actually differs is faded to.
     */
    const onTheme = (): void => {
      const next = themePalette()
      if (JSON.stringify(next) === JSON.stringify(palette)) return
      palette = next
      scene.setPalette(next, !reduced)
    }
    const themeObserver = new MutationObserver(onTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    const schemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    schemeQuery.addEventListener('change', onTheme)
    /* A handle for measuring this screen: the acceptance criteria it was built
     against are all readings off the canvas, and nothing can take them from
     outside without a way in. The renderer runs no code but ours. */
    ;(window as unknown as { __home?: unknown }).__home = { scene: () => sceneRef.current }

    /**
     * What the hero lines are, exactly as the DOM has them.
     *
     * Canvas has no `text-transform`, so uppercase is applied here; it does
     * have `letterSpacing`, and without it the texture comes out narrower than
     * the type it has to sit precisely on top of. Read once per resize, never
     * in the frame loop.
     */
    const measureText = (): HeroLine[] => {
      if (hero === null) return []
      /*
       * Against page one's own pane, not the window. The texture is drawn
       * again whenever something on the page changes - the clock, the counts,
       * the call to action's hover - and that can happen mid-slide or with
       * page two on screen, when every rect in the window's frame is shifted
       * by the slide. Measured that way, the words came back somewhere else.
       */
      const box = (hero.closest('.home__pane') ?? host).getBoundingClientRect()
      const out: HeroLine[] = []
      for (const el of Array.from(hero.querySelectorAll<HTMLElement>('[data-hero-line]'))) {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const text = style.textTransform === 'uppercase' ? (el.textContent ?? '').toUpperCase() : (el.textContent ?? '')
        const vertical = style.writingMode.startsWith('vertical')
        // Truncated in the DOM by CSS; the canvas has to cut at the same place.
        const clipped = vertical ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
        out.push({
          text,
          x: rect.left - box.left,
          y: rect.top - box.top,
          width: rect.width,
          height: rect.height,
          font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`,
          fontSize: parseFloat(style.fontSize),
          letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing,
          alpha: Number(el.dataset.ink ?? '1'),
          rotate: vertical ? 90 : 0,
          maxWidth: clipped ? (vertical ? el.clientHeight : el.clientWidth) : null,
          underline: el.dataset.underline === 'true',
        })
      }
      return out
    }

    let box = host.getBoundingClientRect()
    let dpr = window.devicePixelRatio || 1
    const raster = (): void => scene.setText(measureText(), layoutRules(box.width, box.height))
    rasterRef.current = raster
    const measure = (): void => {
      box = host.getBoundingClientRect()
      dpr = window.devicePixelRatio || 1
      scene.resize(box.width, box.height, dpr)
      raster()
      measureBlocks()
    }
    measure()
    // Every face, explicitly, then again: a texture rasterised before they
    // arrive is the fallback face frozen into a picture.
    void loadFaces().then(() => {
      if (sceneRef.current === scene) raster()
    })
    const observer = new ResizeObserver(measure)
    observer.observe(host)

    // A monitor change moves the device pixel ratio without resizing anything.
    let dprQuery: MediaQueryList | null = null
    const watchDpr = (): void => {
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    const onDpr = (): void => {
      measure()
      watchDpr()
    }
    watchDpr()

    let lastU: number | null = null
    let lastV: number | null = null
    let movedAt = -Infinity
    measureBlocks()
    const onPointerMove = (event: PointerEvent): void => {
      const u = (event.clientX - box.left) / Math.max(1, box.width)
      const v = (event.clientY - box.top) / Math.max(1, box.height)
      if (lastU !== null && lastV !== null) {
        // uv per event, which is what the impulse is specified in.
        scene.push(u, 1 - v, u - lastU, lastV - v)
        movedAt = performance.now()
      }
      lastU = u
      lastV = v
    }
    window.addEventListener('pointermove', onPointerMove)

    /*
     * Context loss is not hypothetical on a laptop that sleeps.
     *
     * Everything here is derived - targets, textures, the text raster - so the
     * answer is to build a second scene rather than to try to restore the
     * first. The overlay must never be left as a blank rectangle.
     */
    const onLost = (event: Event): void => {
      event.preventDefault()
      scene.dispose()
    }
    const onRestored = (): void => {
      scene = createScene(canvas, flags, reduced, palette)
      sceneRef.current = scene
      measure()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    let running = true
    let raf = 0
    let last = performance.now()
    let paused = document.hidden
    let nextFrame = 0

    const loop = (now: number): void => {
      if (!running) return
      raf = requestAnimationFrame(loop)
      if (paused) {
        last = now
        return
      }
      /*
       * Full rate while anything is happening, thirty otherwise.
       *
       * The ambient animation is shapes drifting at two percent of the height
       * a second; nobody can see the difference between sixty frames of that
       * and thirty, and the overlay can be left open on a desk.
       */
      const busy = now - movedAt < 1000 || scene.disturbed() || tweenRef.current !== null
      if (!busy && now < nextFrame) return
      nextFrame = now + (busy ? 0 : 33)

      // rAF does not fire in a hidden window, so the first frame back can
      // carry a minute of elapsed time with it.
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000))
      last = now

      // One value drives the DOM slide and the shader slide, set in the same
      // tick, so they cannot disagree about where the pages are.
      const tween = tweenRef.current
      if (tween !== null) {
        const k = reduced ? 1 : Math.min(1, (now - tween.at) / SLIDE_MS)
        reveal.current = tween.from + (tween.to - tween.from) * ease(k)
        if (k >= 1) {
          reveal.current = tween.to
          tweenRef.current = null
        }
      }
      const track = trackRef.current
      if (track !== null && dragOffsetRef.current === null) {
        track.style.transform = `translate3d(${-reveal.current * 100}%, 0, 0)`
      }
      scene.setProgress(reveal.current)
      scene.frame(dt)
    }
    raf = requestAnimationFrame(loop)

    const onVisibility = (): void => {
      paused = document.hidden
      last = performance.now()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      observer.disconnect()
      themeObserver.disconnect()
      schemeQuery.removeEventListener('change', onTheme)
      dprQuery?.removeEventListener('change', onDpr)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      scene.dispose()
      sceneRef.current = null
      rasterRef.current = null
      delete (window as unknown as { __home?: unknown }).__home
    }
  }, [mounted, reduced])
}
