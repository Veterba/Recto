import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileNode } from '@shared/ipc-contract'
import { version } from '../../../package.json'
import { api } from '../api'
import { createScene, readFlags, type HeroLine, type Rule, type Scene } from './scene'
import { getHomeStats, type HomeStats } from './home-stats'
// Bundled, offline, OFL: only the three faces this screen uses.
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-mono/500.css'

/**
 * A home surface that is not in the navigation.
 *
 * No route - this app has no router, only a workspace tree - no menu entry, no
 * button anywhere in the shell. It opens on its shortcut and closes on Escape,
 * and it is a window over the app rather than a screen in it, so nothing about
 * the workspace changes while it is up.
 *
 * The shortcut is registered as an ordinary command (`home:toggle`), which is
 * what puts it in the palette and in Settings -> Shortcuts without a second
 * list to keep in step.
 */

/** The one place the binding lives. */
export const HOME_HOTKEY = 'Mod+Shift+H'

/**
 * Whether the overlay covers the sidebar.
 *
 * True: one layer over everything, portalled to `document.body`. False: the
 * overlay and its backdrop inset by the sidebar's width, so the sidebar stays
 * sharp and clickable beside it. Both work; true is the default because the
 * point of the surface is to be a room of its own.
 */
export const COVER_SIDEBAR = true

/** How long the pages take to change places, and the curve they do it on. */
const SLIDE_MS = 520

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)`, solved.
 *
 * The DOM slide and the shader slide have to be the same number on the same
 * frame, which rules out letting CSS animate one of them: a transition runs on
 * the compositor's clock and lands wherever it likes relative to a rAF tick.
 * So the curve is evaluated here and written to both.
 */
function ease(t: number): number {
  const x1 = 0.16
  const x2 = 0.3
  const y1 = 1
  const y2 = 1
  const cx = (u: number): number => ((1 - 3 * x2 + 3 * x1) * u + (3 * x2 - 6 * x1)) * u * u + 3 * x1 * u
  const dx = (u: number): number => 3 * (1 - 3 * x2 + 3 * x1) * u * u + 2 * (3 * x2 - 6 * x1) * u + 3 * x1
  let u = t
  for (let i = 0; i < 6; i++) {
    const slope = dx(u)
    if (Math.abs(slope) < 1e-6) break
    u -= (cx(u) - t) / slope
  }
  u = Math.max(0, Math.min(1, u))
  return ((1 - 3 * y2 + 3 * y1) * u + (3 * y2 - 6 * y1)) * u * u + 3 * y1 * u
}

/**
 * Is the keyboard busy typing into something?
 *
 * The overlay's chord must not be stolen from a search box, a rename field or
 * the chat composer. The note editor is the deliberate exception: it is
 * contenteditable, and it is also where you are standing when you reach for
 * this - a rule that excluded it would make the surface unreachable from the
 * only screen anyone is ever on.
 */
export function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (el === null) return false
  if (el.closest('.cm-editor') !== null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

const PANES = ['Recto', 'Statistics'] as const

type Props = {
  open: boolean
  onClose: () => void
  /** Width of the sidebar in px, for the COVER_SIDEBAR = false path. */
  sidebarWidth: number
  /** The open vault's folder, for the vertical line of meta. */
  vaultPath: string
  /** The vault tree, for the last note written to. */
  roots: readonly FileNode[]
}

/**
 * Every face the page draws with, loaded explicitly.
 *
 * `document.fonts.ready` only waits for faces something has already asked
 * for; a face first used by the canvas rasteriser would still be missing on
 * the first draw, and the fallback would be frozen into the texture.
 */
const FACES = ['italic 400 100px "Bodoni Moda"', '500 30px "Geist Sans"', '500 11px "Geist Mono"'] as const
const loadFaces = (): Promise<unknown> => Promise.all(FACES.map((face) => document.fonts.load(face)))

/**
 * The page's grid, in CSS px: margins, the column line at a third of the
 * width, the row line at 78% of the height. Ink at 38%, a gap either side of
 * each crossing, a full-ink crosshair where they meet and two ticks on the
 * row. Drawn into the text texture with everything else, so the river moves
 * them too.
 */
function layoutRules(w: number, h: number): Rule[] {
  const M = 40
  const col = Math.round(w / 3)
  const row = Math.round(h * 0.78)
  const faint = 0.38
  const gap = 18
  const arm = 17
  return [
    { x: col, y: M, width: 1, height: row - gap - M, alpha: faint },
    { x: col, y: row + gap, width: 1, height: h - M - row - gap, alpha: faint },
    { x: M, y: row, width: col - gap - M, height: 1, alpha: faint },
    { x: col + gap, y: row, width: w - M - col - gap, height: 1, alpha: faint },
    { x: col - arm, y: row, width: 2 * arm + 1, height: 1, alpha: 1 },
    { x: col, y: row - arm, width: 1, height: 2 * arm + 1, alpha: 1 },
    { x: Math.round(w / 2), y: row - 4, width: 1, height: 9, alpha: faint },
    { x: Math.round((w * 3) / 4), y: row - 4, width: 1, height: 9, alpha: faint },
  ]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const clockText = (d: Date): string =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`

/** The newest file in the tree, by modification time. */
function lastEdited(roots: readonly FileNode[]): { name: string; at: Date } | null {
  let best: FileNode | null = null
  const walk = (nodes: readonly FileNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') walk(n.children ?? [])
      else if (n.name.endsWith('.md') && (best === null || (n.mtime ?? 0) > (best.mtime ?? 0))) best = n
    }
  }
  walk(roots)
  const found = best as FileNode | null
  if (found === null || found.mtime === undefined) return null
  return { name: found.name.replace(/\.md$/, ''), at: new Date(found.mtime) }
}

/** A home folder written the way a shell would: ~ for /Users/you. */
const tildePath = (path: string): string => path.replace(/^\/(Users|home)\/[^/]+/, '~')

export function HomeOverlay({ open, onClose, sidebarWidth, vaultPath, roots }: Props): React.ReactElement | null {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [pane, setPane] = useState(0)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  /* The loop writes the track's transform every frame; while a finger is down
     the drag owns it instead, and a ref is how the loop learns that without
     being torn down and rebuilt on every pointer move. */
  const dragOffsetRef = useRef<number | null>(null)
  const [stats, setStats] = useState<HomeStats | null>(null)
  /* Live values on page one. The clock ticks at the minute boundary, not per
     frame: the texture is rasterised again only when something it shows has
     changed. */
  const [now, setNow] = useState(() => new Date())
  const [ctaHover, setCtaHover] = useState(false)
  const lastEdit = useMemo(() => lastEdited(roots), [roots])
  /** Rasterise page one's ink again; set by the frame loop's effect. */
  const rasterRef = useRef<(() => void) | null>(null)

  const windowRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const heroRef = useRef<HTMLDivElement | null>(null)
  const statsPaneRef = useRef<HTMLElement | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  /** Pane index as a number the shader can read, eased toward the real one. */
  const reveal = useRef(0)
  const paneRef = useRef(0)
  const tweenRef = useRef<{ from: number; to: number; at: number } | null>(null)

  /*
   * Read when the overlay opens, not when the app starts: this component is
   * mounted for the whole session, and a setting changed at lunchtime should
   * hold the next time the overlay is opened rather than the next time the app
   * is launched.
   */
  const reduced = useMemo(
    () => mounted && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [mounted],
  )

  // --- open and close -----------------------------------------------------

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement | null
      setMounted(true)
      setPane(0)
      paneRef.current = 0
      reveal.current = 0
      tweenRef.current = null
      return
    }
    setShown(false)
    // Let the exit animation run before the tree - and the GL context - go.
    const timer = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!mounted) return
    /*
     * A frame later, so the browser has painted the closed state and the
     * transition has something to run from. The timer is a belt: an occluded
     * window throttles rAF to nothing, and an overlay that opened at opacity 0
     * and stayed there is indistinguishable from a bug.
     */
    const frame = requestAnimationFrame(() => setShown(true))
    const timer = window.setTimeout(() => setShown(true), 48)
    // The keyboard comes with it: a modal you can still type into the note
    // behind is not modal, and Tab has to start somewhere inside.
    windowRef.current?.focus()
    void getHomeStats().then(setStats)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [mounted])

  useEffect(() => {
    if (mounted) return
    // Nothing of this screen is left running when it is not on screen.
    setStats(null)
    const previous = restoreFocus.current
    restoreFocus.current = null
    previous?.focus?.()
  }, [mounted])

  // --- the one frame loop -------------------------------------------------

  useEffect(() => {
    if (!mounted) return
    const canvas = canvasRef.current
    const host = windowRef.current
    const hero = heroRef.current
    if (canvas === null || host === null) return

    const flags = readFlags()
    let scene = createScene(canvas, flags, reduced)
    sceneRef.current = scene
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
      scene = createScene(canvas, flags, reduced)
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

  /**
   * Where page two's content sits, in that page's own frame.
   *
   * The glass field is held dark behind each block so white type keeps its
   * contrast. Measured against the pane rather than the window, because the
   * pane is mid-slide half the time; the answer is where the block will be
   * once it has arrived.
   */
  const measureBlocks = useCallback((): void => {
    const pane = statsPaneRef.current
    const scene = sceneRef.current
    if (pane === null || scene === null) return
    const origin = pane.getBoundingClientRect()
    const rects = Array.from(pane.querySelectorAll<HTMLElement>('.home__back, .home__figure, .home__list')).map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height }
    })
    scene.setBlocks(rects)
  }, [])

  // The figures arrive after the first paint; measure once they are laid out.
  useEffect(() => {
    const frame = requestAnimationFrame(measureBlocks)
    return () => cancelAnimationFrame(frame)
  }, [stats, measureBlocks])

  // The clock, on the minute boundary: one timer to the next minute, then
  // again - never an interval that drifts off the edge of the minute.
  useEffect(() => {
    if (!mounted) return
    let timer = 0
    const tick = (): void => {
      const at = new Date()
      setNow(at)
      timer = window.setTimeout(tick, 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds()) + 20)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [mounted])

  // The figures follow the vault while the overlay is open, a second behind.
  useEffect(() => {
    if (!mounted) return
    let timer = 0
    const off = api.on('vault:changed', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void getHomeStats().then(setStats), 1000)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [mounted])

  // Anything page one shows changed: lay it out, then rasterise once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => rasterRef.current?.())
    return () => cancelAnimationFrame(frame)
  }, [now, stats, lastEdit, vaultPath, ctaHover])

  // --- panes --------------------------------------------------------------

  const goTo = useCallback((next: number): void => {
    const clamped = Math.max(0, Math.min(PANES.length - 1, next))
    if (clamped === paneRef.current && tweenRef.current === null) return
    paneRef.current = clamped
    tweenRef.current = { from: reveal.current, to: clamped, at: performance.now() }
    setPane(clamped)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowRight') goTo(paneRef.current + 1)
      if (event.key === 'ArrowLeft') goTo(paneRef.current - 1)
      if (event.key !== 'Tab') return
      // Trap: the overlay is modal, so Tab may not walk out into the app
      // behind it.
      const focusable = windowRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')
      if (focusable === undefined || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mounted, goTo, onClose])

  /** Trackpad: a horizontal flick, not every stray deltaX on a vertical scroll. */
  const wheelLock = useRef(0)
  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (Math.abs(event.deltaX) < 40 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
      const now = performance.now()
      if (now - wheelLock.current < 600) return
      wheelLock.current = now
      goTo(paneRef.current + (event.deltaX > 0 ? 1 : -1))
    },
    [goTo],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      if (target.closest('button') !== null) return
      const startX = event.clientX
      const startAt = performance.now()
      const width = windowRef.current?.clientWidth ?? 1
      let dx = 0
      const move = (moved: PointerEvent): void => {
        dx = moved.clientX - startX
        // 1:1 with the pointer while the hand is down.
        dragOffsetRef.current = dx
        setDragOffset(dx)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        dragOffsetRef.current = null
        setDragOffset(null)
        const elapsed = Math.max(1, performance.now() - startAt)
        const fling = Math.abs(dx) / elapsed > 0.55
        if (Math.abs(dx) > width * 0.25 || fling) goTo(paneRef.current + (dx < 0 ? 1 : -1))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [goTo],
  )

  if (!mounted) return null

  const inset = COVER_SIDEBAR ? 0 : sidebarWidth

  return createPortal(
    <div className={`home${shown ? ' is-shown' : ''}`} style={{ left: inset }}>
      <div className="home__backdrop" onMouseDown={onClose} role="presentation" />
      <div
        className="home__window"
        role="dialog"
        aria-modal="true"
        aria-label="Recto home"
        ref={windowRef}
        tabIndex={-1}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
      >
        <canvas className="home__canvas" ref={canvasRef} aria-hidden="true" />
        <p className="home__live" aria-live="polite">
          {PANES[pane]}
        </p>

        <div
          className="home__track"
          ref={trackRef}
          style={dragOffset === null ? undefined : { transform: `translate3d(calc(${-pane * 100}% + ${dragOffset}px), 0, 0)`, transition: 'none' }}
        >
          <section className="home__pane home__pane--hero" aria-label="Recto">
            {/*
              Everything here is drawn by the shader, from a texture rasterised
              off these very elements - rules included - so the river moves all
              of it. The elements keep their layout, their place in the
              accessibility tree and, for the call to action, the click; only
              their ink is transparent.
            */}
            <div className="home__hero" ref={heroRef}>
              <p className="home__meta home__meta--tl" data-hero-line data-ink="0.78">
                Recto / Home
              </p>
              <p className="home__meta home__meta--top" data-hero-line data-ink="0.78">
                Index 01 — Home
              </p>
              <p className="home__meta home__meta--tr" data-hero-line data-ink="0.78">
                <time dateTime={now.toISOString()}>{clockText(now)}</time>
              </p>
              <p className="home__meta home__meta--vault" data-hero-line data-ink="0.78">
                {tildePath(vaultPath)}
              </p>
              <div className="home__meta home__meta--creed">
                <span data-hero-line data-ink="0.78">Notes are files.</span>
                <span data-hero-line data-ink="0.78">The index is a cache.</span>
                <span data-hero-line data-ink="0.78">Nothing is converted.</span>
              </div>

              <div className="home__title">
                <h1 className="home__name" data-hero-line>
                  Recto
                </h1>
                <p className="home__statement">
                  <span data-hero-line>Your personal</span>
                  <span data-hero-line>knowledge manager</span>
                </p>
              </div>

              <p className="home__meta home__meta--counts" data-hero-line data-ink="0.78">
                {stats === null ? '—' : `${stats.notes} notes — ${stats.links} links — ${stats.tags} tags`}
              </p>
              <p className="home__meta home__meta--edit" data-hero-line data-ink="0.78">
                {lastEdit === null
                  ? 'Last edit — none'
                  : `Last edit — ${lastEdit.name} · ${pad2(lastEdit.at.getHours())}:${pad2(lastEdit.at.getMinutes())}`}
              </p>
              <button
                className="home__cta"
                type="button"
                onClick={() => goTo(1)}
                onPointerEnter={() => setCtaHover(true)}
                onPointerLeave={() => setCtaHover(false)}
                onFocus={() => setCtaHover(true)}
                onBlur={() => setCtaHover(false)}
                data-hero-line
                data-underline={ctaHover}
              >
                Show your statistics →
              </button>

              <p className="home__meta home__meta--bl" data-hero-line data-ink="0.78">
                Local vault · Markdown
              </p>
              <p className="home__meta home__meta--bottom" data-hero-line data-ink="0.78">
                Esc to close
              </p>
              <p className="home__meta home__meta--br" data-hero-line data-ink="0.78">
                v{version}
              </p>
            </div>
          </section>

          <section className="home__pane" aria-label="Statistics" ref={statsPaneRef}>
            <Statistics stats={stats} onBack={() => goTo(0)} />
          </section>
        </div>

      </div>
    </div>,
    document.body,
  )
}

/**
 * The figures.
 *
 * Sparse on purpose: a number, a label under it, nothing drawn around it.
 * Monochrome, like the field behind it: no accent colour anywhere.
 */
function Statistics({ stats, onBack }: { stats: HomeStats | null; onBack: () => void }): React.ReactElement {
  if (stats === null) return <div className="home__stats home__stats--waiting">Reading the vault…</div>

  return (
    <div className="home__stats">
      <div className="home__figures">
        <Figure value={String(stats.notes)} label="notes" />
        <Figure value={String(stats.touchedThisWeek)} label="touched this week" trend={stats.weekTrend} />
        <Figure value={String(stats.links)} label="links" />
        <Figure value={String(stats.tags)} label="tags" />
        <Figure value={stats.streakDays === null ? '—' : String(stats.streakDays)} label="day streak" />
        <Figure value={stats.minutesToday === null ? '—' : `${stats.minutesToday}m`} label="in the app today" />
      </div>

      <div className="home__lists">
        {stats.topFolders.length > 0 && (
          <div className="home__list">
            <p className="home__label">most written in</p>
            {stats.topFolders.map((folder) => (
              <p className="home__row" key={folder.name}>
                <span>{folder.name}</span>
                <span className="home__count">{folder.count}</span>
              </p>
            ))}
          </div>
        )}
        {stats.hubs.length > 0 && (
          <div className="home__list">
            <p className="home__label">most linked</p>
            {stats.hubs.map((hub) => (
              <p className="home__row" key={hub.name}>
                <span>{hub.name}</span>
                <span className="home__count">{hub.links}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <button className="home__back" type="button" onClick={onBack}>
        <span className="home__arrow" aria-hidden="true">←</span> back
      </button>
    </div>
  )
}

function Figure({ value, label, trend }: { value: string; label: string; trend?: number[] }): React.ReactElement {
  return (
    <div className="home__figure">
      <p className="home__number">{value}</p>
      <p className="home__label">{label}</p>
      {trend !== undefined && trend.some((n) => n > 0) && <Sparkline values={trend} />}
    </div>
  )
}

/** A week of writing, as one line. No axes, no grid, no library. */
function Sparkline({ values }: { values: number[] }): React.ReactElement {
  const top = Math.max(1, ...values)
  const points = values
    .map((value, i) => `${(i / Math.max(1, values.length - 1)) * 100},${18 - (value / top) * 16}`)
    .join(' ')
  return (
    <svg className="home__spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
