import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The toolbar's table size picker: an 8 × 8 grid, hover or arrow to size,
 * click or Enter to insert. Opens on 3 × 3, so Enter alone gives the common
 * table. The size reads columns × rows, the header row counted.
 */

const MAX = 8

type Props = {
  anchor: DOMRect
  /** The button that opened it: a press on it toggles, it is not a click outside. */
  trigger: HTMLElement | null
  onPick: (columns: number, rows: number) => void
  onClose: () => void
}

export function TablePicker({ anchor, trigger, onPick, onClose }: Props): React.ReactElement {
  const [size, setSize] = useState({ columns: 3, rows: 3 })
  const ref = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState({ left: anchor.left, top: anchor.bottom + 6 })

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    setAt({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8)), top: anchor.bottom + 6 })
  }, [anchor])

  useEffect(() => {
    ref.current?.focus()
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (ref.current?.contains(target) === true || trigger?.contains(target) === true) return
      onClose()
    }
    window.addEventListener('mousedown', outside, true)
    return () => window.removeEventListener('mousedown', outside, true)
  }, [onClose, trigger])

  const clamp = (n: number): number => Math.max(1, Math.min(MAX, n))

  return createPortal(
    <div
      ref={ref}
      className="table-picker glass-surface"
      role="dialog"
      aria-label="Insert table"
      tabIndex={-1}
      style={{ left: at.left, top: at.top }}
      onKeyDown={(event) => {
        const moves: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }
        const move = moves[event.key]
        if (move !== undefined) {
          event.preventDefault()
          setSize((s) => ({ columns: clamp(s.columns + move[0]), rows: clamp(s.rows + move[1]) }))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          onPick(size.columns, size.rows)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="table-picker__grid" onMouseLeave={() => undefined}>
        {Array.from({ length: MAX * MAX }, (_, i) => {
          const columns = (i % MAX) + 1
          const rows = Math.floor(i / MAX) + 1
          const on = columns <= size.columns && rows <= size.rows
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className={`table-picker__cell${on ? ' is-on' : ''}`}
              aria-label={`${columns} × ${rows}`}
              onMouseEnter={() => setSize({ columns, rows })}
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(columns, rows)
              }}
            />
          )
        })}
      </div>
      <p className="table-picker__size">
        {size.columns} × {size.rows}
      </p>
    </div>,
    document.body,
  )
}
