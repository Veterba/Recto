import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileNode } from '@shared/vault'
import { version } from '../../../../../package.json'
import { api } from '../../../app/api'
import { type Scene } from '../scene'
import { getHomeStats, type HomeStats } from '../home-stats'
import { IPC_EVENT } from '@shared/ipc'
import { useHomeScene } from '../hooks/use-home-scene'
import { Statistics } from './HomeStatistics'
import { lastEdited, clockText, tildePath, pad2 } from '../hero-text'
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

/**
 * Whether the overlay covers the sidebar.
 *
 * True: one layer over everything, portalled to `document.body`. False: the
 * overlay and its backdrop inset by the sidebar's width, so the sidebar stays
 * sharp and clickable beside it. Both work; true is the default because the
 * point of the surface is to be a room of its own.
 */
const COVER_SIDEBAR = true

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
  const reduced = useMemo(() => mounted && window.matchMedia('(prefers-reduced-motion: reduce)').matches, [mounted])

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

  // --- the one frame loop -------------------------------------------------
  useHomeScene({
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
  })

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
    const off = api.on(IPC_EVENT.vaultChanged, () => {
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
          style={
            dragOffset === null
              ? undefined
              : { transform: `translate3d(calc(${-pane * 100}% + ${dragOffset}px), 0, 0)`, transition: 'none' }
          }
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
                <span data-hero-line data-ink="0.78">
                  Notes are files.
                </span>
                <span data-hero-line data-ink="0.78">
                  The index is a cache.
                </span>
                <span data-hero-line data-ink="0.78">
                  Nothing is converted.
                </span>
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
