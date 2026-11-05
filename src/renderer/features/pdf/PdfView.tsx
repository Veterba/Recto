import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { rectsOn, useHighlights, type Highlight } from './pdf-highlights'
import './pdf.css'

/**
 * A PDF, as in Heptabase: every page, one under another, scrolled. Two ways:
 *
 * - `preview`, on a canvas: the pages and the highlights already made, nothing
 *   to select - a double-click opens the reader beside the canvas.
 * - `reader`, in a tab (the pane beside a canvas): the text can be selected and
 *   highlighted, with zoom and the page count in a bar at the bottom.
 *
 * Pages are drawn only when they come into view (pdf.js, in a worker); in the
 * reader their text is laid over them, invisible, for selecting. The bytes come
 * through Recto, not a fetch: the vault's files are not served to the page
 * across origins. Highlights are kept by the PDF's path (pdf-highlights.ts), so
 * both ways show the same ones.
 */

GlobalWorkerOptions.workerSrc = workerUrl

/** Opened once per PDF, however many nodes show it. */
const documents = new Map<string, Promise<PDFDocumentProxy>>()
function openPdf(path: string): Promise<PDFDocumentProxy> {
  let doc = documents.get(path)
  if (doc === undefined) {
    doc = api.invoke(IPC.fsReadBytes, path).then((got) => {
      if (!got.ok) throw new Error(got.error)
      return getDocument({ data: got.data }).promise
    })
    doc.catch(() => documents.delete(path))
    documents.set(path, doc)
  }
  return doc
}

/** How much sharper than its size on screen a page is drawn, so it stays crisp zoomed in a little. */
const SHARPNESS = 2

function Page({
  doc,
  number,
  width,
  ratio,
  highlights,
  onRemove,
  selectable,
}: {
  doc: PDFDocumentProxy
  number: number
  width: number
  ratio: number
  highlights: readonly Highlight[]
  /** Null in a preview: highlights are shown, not taken away. */
  onRemove: ((id: string) => void) | null
  /** The text laid over the page, to select: the reader's, not a preview's. */
  selectable: boolean
}): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const text = useRef<HTMLDivElement | null>(null)
  const [seen, setSeen] = useState(false)

  // Drawn the first time it comes near the view, not before.
  useEffect(() => {
    const el = box.current
    if (el === null || seen) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!seen || width <= 0) return
    let cancelled = false
    let layer: TextLayer | null = null
    void doc.getPage(number).then(async (page) => {
      // The text layer is the reader's only: a preview draws the page without it.
      if (cancelled || canvas.current === null || (selectable && text.current === null)) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const sharp = page.getViewport({ scale: (width / base.width) * SHARPNESS * (window.devicePixelRatio || 1) })
      canvas.current.width = Math.floor(sharp.width)
      canvas.current.height = Math.floor(sharp.height)
      await page.render({ canvas: canvas.current, viewport: sharp }).promise.catch(() => {})
      if (cancelled || !selectable || text.current === null) return
      text.current.replaceChildren()
      text.current.style.setProperty('--total-scale-factor', String(viewport.scale))
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport })
      await layer.render().catch(() => {})
    })
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [seen, doc, number, width, selectable])

  return (
    <div
      className="pdf-view__page"
      ref={box}
      data-page={number}
      style={{ height: width * ratio }}
      // A click on a highlight (not a selection made over it) takes it away. The text lies over the
      // highlights, to be selectable, so the page finds which one the click fell in.
      onClick={(ev) => {
        if (onRemove === null || window.getSelection()?.isCollapsed === false) return
        const page = ev.currentTarget.getBoundingClientRect()
        const x = (ev.clientX - page.left) / page.width
        const y = (ev.clientY - page.top) / page.height
        const hit = highlights.find((h) => h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h))
        if (hit !== undefined) onRemove(hit.id)
      }}
    >
      <canvas ref={canvas} className="pdf-view__canvas" />
      {highlights.map((h) =>
        h.rects.map((r, i) => (
          <div
            key={`${h.id}-${i}`}
            className="pdf-view__mark"
            title={onRemove === null ? h.text : `“${h.text}” - click to remove the highlight`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          />
        )),
      )}
      {selectable && <div ref={text} className="textLayer pdf-view__text nodrag" />}
    </div>
  )
}

/** The reader's zoom steps, as multiples of the page fitting the width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

export function PdfView({
  path,
  mode,
  page: startAt = 1,
  onScroll,
  onPage,
  onOpen,
  far = false,
}: {
  path: string
  mode: 'preview' | 'reader'
  /** The page to show first (a node's `#page=N`). */
  page?: number
  onScroll?: (ev: React.WheelEvent<HTMLElement>) => void
  /** The page in view changed. */
  onPage?: (page: number) => void
  /** A preview double-clicked: open the reader. */
  onOpen?: () => void
  /** A preview too small to read (the canvas zoomed far out): its first page only, the rest not drawn. */
  far?: boolean
}): React.ReactElement {
  const reader = mode === 'reader'
  const [zoom, setZoom] = useState(1)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ratios, setRatios] = useState<number[]>([])
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<{ page: number; x: number; y: number } | null>(null)
  const [current, setCurrent] = useState(startAt)
  const scroller = useRef<HTMLDivElement | null>(null)
  const { highlights, add, remove } = useHighlights(path)

  useEffect(() => {
    let live = true
    openPdf(path).then(
      async (opened) => {
        // Every page's shape first, so the scroll is the whole document's from the start.
        const shapes: number[] = []
        for (let n = 1; n <= opened.numPages; n++) {
          const v = (await opened.getPage(n)).getViewport({ scale: 1 })
          shapes.push(v.height / v.width)
        }
        if (!live) return
        setRatios(shapes)
        setDoc(opened)
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      live = false
    }
  }, [path])

  // The pages are as wide as the node, in its own (unzoomed) size.
  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    // Less the scroll bar, so a page that fits the width never makes the view scroll sideways.
    const fit = (): number => Math.max(0, el.clientWidth - (reader ? 24 : 0))
    const ro = new ResizeObserver(() => setWidth(fit()))
    ro.observe(el)
    setWidth(fit())
    return () => ro.disconnect()
  }, [reader])

  // Opened at its page.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || doc === null || width === 0 || startAt <= 1) return
    placed.current = true
    scroller.current?.querySelector<HTMLElement>(`[data-page="${startAt}"]`)?.scrollIntoView({ block: 'start' })
  }, [doc, width, startAt])

  const track = useCallback(() => {
    const el = scroller.current
    if (el === null) return
    const top = el.getBoundingClientRect().top
    let at = 1
    for (const page of el.querySelectorAll<HTMLElement>('.pdf-view__page')) {
      if (page.getBoundingClientRect().top - top <= el.clientHeight / 3) at = Number(page.dataset['page'])
    }
    if (at !== current) {
      setCurrent(at)
      onPage?.(at)
    }
  }, [current, onPage])

  /** A selection made in a page's text: the Highlight button shows by it. */
  const selected = useCallback(() => {
    const sel = window.getSelection()
    const el = scroller.current
    if (sel === null || sel.isCollapsed || el === null || sel.rangeCount === 0) return setSelection(null)
    const range = sel.getRangeAt(0)
    const page = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('.pdf-view__page')
    if (page == null || !el.contains(page)) return setSelection(null)
    const end = range.getBoundingClientRect()
    const host = el.getBoundingClientRect()
    // In the node's own size: the canvas may be zoomed.
    const zoom = host.width / el.clientWidth || 1
    setSelection({ page: Number(page.dataset['page']), x: (end.right - host.left) / zoom, y: (end.bottom - host.top) / zoom + el.scrollTop })
  }, [])

  const highlight = (): void => {
    const sel = window.getSelection()
    const el = scroller.current
    if (sel === null || sel.rangeCount === 0 || selection === null || el === null) return
    const page = el.querySelector<HTMLElement>(`[data-page="${selection.page}"]`)
    if (page === null) return
    const rects = rectsOn(page.getBoundingClientRect(), [...sel.getRangeAt(0).getClientRects()])
    if (rects.length > 0) add({ page: selection.page, rects, text: sel.toString().trim() })
    sel.removeAllRanges()
    setSelection(null)
  }

  const step = (by: number): void => {
    const at = ZOOMS.findIndex((z) => z >= zoom)
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at === -1 ? ZOOMS.length - 1 : at) + by))]!)
  }

  if (error !== null) return <p className="canvas-node__empty pdf-view__error">This PDF could not be opened: {error}</p>
  return (
    <div className={`pdf-view is-${mode}`}>
      <div
        ref={scroller}
        className="pdf-view__scroll"
        onWheelCapture={onScroll}
        onScroll={track}
        {...(reader ? { onMouseUp: selected, onKeyUp: selected } : { onDoubleClick: onOpen })}
      >
        {doc !== null &&
          (far && !reader ? ratios.slice(0, 1) : ratios).map((ratio, i) => (
            <Page
              key={i + 1}
              doc={doc}
              number={i + 1}
              width={reader ? width * zoom : width}
              ratio={ratio}
              highlights={highlights.filter((h) => h.page === i + 1)}
              onRemove={reader ? remove : null}
              selectable={reader}
            />
          ))}
        {selection !== null && (
          <button
            className="pdf-view__add nodrag"
            style={{ left: selection.x, top: selection.y + 6 }}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={highlight}
          >
            Highlight
          </button>
        )}
      </div>
      {doc !== null &&
        (reader ? (
          <div className="pdf-bar glass-surface" role="toolbar" aria-label="PDF">
            <button className="pdf-bar__button" aria-label="Zoom out" onClick={() => step(-1)}>
              −
            </button>
            <button className="pdf-bar__button pdf-bar__zoom" aria-label="Fit the width" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button className="pdf-bar__button" aria-label="Zoom in" onClick={() => step(1)}>
              +
            </button>
            <span className="pdf-bar__gap" />
            <span className="pdf-bar__count">
              {current} / {doc.numPages}
            </span>
          </div>
        ) : (
          <span className="pdf-view__count">
            {current} / {doc.numPages}
          </span>
        ))}
    </div>
  )
}
