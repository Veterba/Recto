import { useEffect, useMemo, useRef } from 'react'
import type { CanvasDoc } from '@shared/canvas'
import { Icon } from '../../../ui/Icon'
import { searchText } from '../canvas-edit'

/**
 * ⌘F on a canvas: what you type is looked for in every node's text, file name,
 * link and label; Enter goes to the next one (⇧Enter back), zooming to it.
 */
export function CanvasSearch({
  doc,
  query,
  setQuery,
  index,
  setIndex,
  onShow,
  onClose,
}: {
  doc: CanvasDoc
  query: string
  setQuery: (query: string) => void
  index: number
  setIndex: (index: number) => void
  onShow: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => input.current?.select(), [])
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? [] : doc.nodes.filter((n) => searchText(n).toLowerCase().includes(q)).map((n) => n.id)
  }, [doc, query])

  // The match in view as the query or the step changes.
  const current = hits.length === 0 ? null : hits[((index % hits.length) + hits.length) % hits.length]!
  useEffect(() => {
    if (current !== null) onShow(current)
  }, [current, onShow])

  return (
    <div className="canvas-search" role="search">
      <Icon name="search" size={14} />
      <input
        ref={input}
        className="canvas-search__input"
        placeholder="Find on canvas"
        aria-label="Find on canvas"
        value={query}
        onChange={(ev) => {
          setQuery(ev.target.value)
          setIndex(0)
        }}
        onKeyDown={(ev) => {
          ev.stopPropagation()
          if (ev.key === 'Escape') onClose()
          if (ev.key === 'Enter') setIndex(index + (ev.shiftKey ? -1 : 1))
        }}
      />
      <span className="canvas-search__count">
        {query.trim() === '' ? '' : hits.length === 0 ? 'None' : `${hits.indexOf(current!) + 1}/${hits.length}`}
      </span>
      <button className="icon-btn" aria-label="Close search" onClick={onClose}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
