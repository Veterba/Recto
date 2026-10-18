import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileNode } from '@shared/vault'
import { version } from '../../../../../package.json'
import { api } from '../../../app/api'
import { type Scene } from '../scene'
import { IPC_EVENT } from '@shared/ipc'
import { dayOf, type OverviewData, type OverviewTopic, type OverviewView } from '@shared/overview'
import { commands } from '../../../app/commands'
import { formatChord } from '../../../app/hotkeys'
import { cachedData, cachedTopics, currentPlace, fetchData, fetchTopics, savePlace } from '../overview-store'
import { Overview, OverviewList, type OverviewActions } from './Overview'
import { useHomeScene } from '../hooks/use-home-scene'
import { readFlags } from '../scene-flags'
import { lastEdited, clockText, tildePath, pad2, META_INK } from '../hero-text'
// Bundled, offline, OFL: only the three faces this screen uses.
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-mono/500.css'

/**
 * A home surface that is not in the navigation: the welcome, then the vault's figures.
 *
 * No route - this app has no router, only a workspace tree - no menu entry, no
 * button anywhere in the shell. It opens on its shortcut and closes on Escape,
 * and it is a window over the app rather than a screen in it, so nothing about
 * the workspace changes while it is up.
 *
 * The shortcut is registered as an ordinary command (`app:home`), which is
 * what puts it in the palette and in Settings -> Shortcuts without a second
 * list to keep in step. Pressed again it closes, back on the note or board you
 * were on. Where it was left - the pane, the figures' page and their scroll -
 * is kept in userData and restored on the next opening, after a restart too.
 *
 * Page two scrolls as a whole, wherever the pointer is: the vault's name on
 * the field (drawn by the shader, like the hero), and under it a solid card
 * with every figure. Nothing of the figures sits on the field itself.
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

const MAIN: OverviewView = { kind: 'main' }

type Props = {
  open: boolean
  onClose: () => void
  /** Width of the sidebar in px, for the COVER_SIDEBAR = false path. */
  sidebarWidth: number
  /** The open vault's folder, for the vertical line of meta. */
  vaultPath: string
  /** The vault tree, for the last note written to. */
  roots: readonly FileNode[]
  vaultName: string
  /** Is there a note at this path now? A day's list keeps names of notes since deleted. */
  exists: (path: string) => boolean
  /** A template, not a note: never flagged as needing attention. */
  isTemplate: (path: string) => boolean
  /** A board's Done column, and its name. */
  onOpenNote: (path: string) => void
  onOpenCard: (path: string) => void
  onOpenFolder: (name: string) => void
}

export function HomeOverlay({
  open,
  onClose,
  sidebarWidth,
  vaultPath,
  roots,
  vaultName,
  exists,
  isTemplate,
  onOpenNote,
  onOpenCard,
  onOpenFolder,
}: Props): React.ReactElement | null {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [pane, setPane] = useState(0)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  /* The loop writes the track's transform every frame; while a finger is down
     the drag owns it instead, and a ref is how the loop learns that without
     being torn down and rebuilt on every pointer move. */
  const dragOffsetRef = useRef<number | null>(null)
  const [view, setView] = useState<OverviewView>(MAIN)
  const [data, setData] = useState<OverviewData | null>(null)
  const [topics, setTopics] = useState<OverviewTopic[] | null>(null)
  /* The day and time the figures are worked out against: when they were read. */
  const [clock, setClock] = useState(() => ({ today: dayOf(new Date()), now: Date.now() }))
  const [scrolling, setScrolling] = useState(false)
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
  const scrollerRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  /** Where page two should scroll to once what it shows is on the page. */
  const scrollTo = useRef<number | null>(null)
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
      const place = currentPlace()
      setView(place.view)
      scrollTo.current = place.view.kind === 'main' ? place.mainScroll : place.viewScroll
      setData(cachedData())
      setTopics(cachedTopics())
      setClock({ today: dayOf(new Date()), now: Date.now() })
      setMounted(true)
      // Straight onto the pane it was left on: no slide in from the welcome.
      setPane(place.pane)
      paneRef.current = place.pane
      reveal.current = place.pane
      tweenRef.current = null
      return
    }
    setShown(false)
    // Let the exit animation run before the tree - and the GL context - go.
    const timer = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(timer)
  }, [open])

  const refresh = useCallback(() => {
    const today = dayOf(new Date())
    const at = Date.now()
    void fetchData(today, at).then((next) => {
      if (next === null) return
      setClock({ today, now: at })
      setData(next)
    })
    void fetchTopics().then(setTopics)
  }, [])

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
    refresh()
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [mounted, refresh])

  useEffect(() => {
    if (mounted) return
    const previous = restoreFocus.current
    restoreFocus.current = null
    // Without preventScroll, focusing the editor scrolls it to its caret -
    // and closing must land exactly where you were.
    previous?.focus?.({ preventScroll: true })
  }, [mounted])
  // --- the one frame loop -------------------------------------------------
  useHomeScene({
    canvasRef,
    dragOffsetRef,
    heroRef,
    titleRef,
    scrollerRef,
    mounted,
    rasterRef,
    reduced,
    reveal,
    sceneRef,
    trackRef,
    tweenRef,
    windowRef,
  })

  /*
   * Page two's scroll is put back once the page it belongs to has its figures:
   * the placeholder is shorter, and a scroll set on it would be clamped short.
   */
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || scrollTo.current === null || data === null) return
    scroller.scrollTop = scrollTo.current
    scrollTo.current = null
  }, [mounted, view, data])

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
      timer = window.setTimeout(refresh, 1000)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [mounted, refresh])

  // Anything the shader draws changed: lay it out, then rasterise once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => rasterRef.current?.())
    return () => cancelAnimationFrame(frame)
  }, [now, data, lastEdit, vaultPath, vaultName, ctaHover])

  // --- panes --------------------------------------------------------------

  const goTo = useCallback((next: number): void => {
    const clamped = Math.max(0, Math.min(PANES.length - 1, next))
    if (clamped === paneRef.current && tweenRef.current === null) return
    paneRef.current = clamped
    tweenRef.current = { from: reveal.current, to: clamped, at: performance.now() }
    setPane(clamped)
    savePlace({ ...currentPlace(), pane: clamped === 1 ? 1 : 0 })
  }, [])

  // --- page two: its page and scroll ----------------------------------------

  const go = useCallback((next: OverviewView) => {
    const scroller = scrollerRef.current
    const place = currentPlace()
    if (next.kind === 'main') {
      savePlace({ ...place, view: next, viewScroll: 0 })
      scrollTo.current = place.mainScroll
    } else {
      savePlace({ ...place, view: next, mainScroll: scroller?.scrollTop ?? place.mainScroll, viewScroll: 0 })
      scrollTo.current = 0
    }
    setView(next)
  }, [])

  /** The scrollbar shows while the page moves, and fades after. */
  const scrollTimer = useRef(0)
  const onScroll = useCallback(() => {
    setScrolling(true)
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => setScrolling(false), 800)
    const scroller = scrollerRef.current
    if (scroller === null || scrollTo.current !== null) return
    const place = currentPlace()
    savePlace(place.view.kind === 'main' ? { ...place, mainScroll: scroller.scrollTop } : { ...place, viewScroll: scroller.scrollTop })
  }, [])

  const actions: OverviewActions = useMemo(
    () => ({
      go,
      // Leaving to a note keeps everything as it is: ⌃⌘H comes back to it.
      openNote: (path) => {
        onClose()
        onOpenNote(path)
      },
      openCard: (path) => {
        onClose()
        onOpenCard(path)
      },
      openFolder: (name) => {
        onClose()
        onOpenFolder(name)
      },
    }),
    [go, onClose, onOpenNote, onOpenCard, onOpenFolder],
  )

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
  const shownData =
    data === null
      ? null
      : {
          ...data,
          index: { ...data.index, orphans: data.index.orphans.filter((n) => !isTemplate(n.path)), broken: data.index.broken.filter((b) => !isTemplate(b.path)) },
        }
  const binding = commands.bindingFor('app:home')

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
              <p className="home__meta home__meta--tl" data-hero-line data-ink={META_INK}>
                Recto / Home
              </p>
              <p className="home__meta home__meta--top" data-hero-line data-ink={META_INK}>
                Index 01 — Home
              </p>
              <p className="home__meta home__meta--tr" data-hero-line data-ink={META_INK}>
                <time dateTime={now.toISOString()}>{clockText(now)}</time>
              </p>
              <p className="home__meta home__meta--vault" data-hero-line data-ink={META_INK}>
                {tildePath(vaultPath)}
              </p>
              <div className="home__meta home__meta--creed">
                <span data-hero-line data-ink={META_INK}>
                  Notes are files.
                </span>
                <span data-hero-line data-ink={META_INK}>
                  The index is a cache.
                </span>
                <span data-hero-line data-ink={META_INK}>
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

              <p className="home__meta home__meta--counts" data-hero-line data-ink={META_INK}>
                {data === null ? '—' : `${data.index.notes} notes — ${data.index.links} links — ${data.index.tags} tags`}
              </p>
              <p className="home__meta home__meta--edit" data-hero-line data-ink={META_INK}>
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

              <p className="home__meta home__meta--bl" data-hero-line data-ink={META_INK}>
                Local vault · Markdown
              </p>
              <p className="home__meta home__meta--bottom" data-hero-line data-ink={META_INK}>
                Esc to close
              </p>
              <p className="home__meta home__meta--br" data-hero-line data-ink={META_INK}>
                v{readFlags().fixedVersion ? '0.0.0' : version}
              </p>
            </div>
          </section>

          <section className="home__pane home__pane--stats" aria-label="Statistics">
            <div className={`overview__scroller${scrolling ? ' is-scrolling' : ''}`} ref={scrollerRef as React.RefObject<HTMLDivElement>} onScroll={onScroll} data-view={view.kind}>
              {/* Drawn by the shader, like the hero: the DOM keeps its place and its name for screen readers. */}
              <div className="overview__title" ref={titleRef}>
                <h1 className="overview__name" data-hero-line>
                  {vaultName}
                </h1>
              </div>
              <main className="overview">
                {view.kind === 'main' ? (
                  <Overview data={shownData} topics={topics} today={clock.today} now={clock.now} actions={actions} />
                ) : (
                  <OverviewList view={view} data={shownData} topics={topics} today={clock.today} exists={exists} actions={actions} />
                )}
              </main>
              <div className="overview__end" aria-hidden="true" />
            </div>
            <div className="overview__corners">
              <button className="overview__corner" type="button" onClick={view.kind === 'main' ? () => goTo(0) : () => go(MAIN)}>
                <span aria-hidden="true">←</span> Back
              </button>
              {binding !== null && <span className="overview__corner overview__corner--hint">{formatChord(binding)}</span>}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
