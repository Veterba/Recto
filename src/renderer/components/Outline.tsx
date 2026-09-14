import { useMemo } from 'react'
import { currentSection, outlineOf } from '../core/outline'
import { Icon } from './Icon'

/**
 * The note's headings, as a panel beside the text - Obsidian's Outline.
 *
 * Built from the live text, so it follows typing, and it marks the section the
 * caret is in so the panel doubles as a "where am I" in a long note. Clicking
 * a heading moves the caret there, which also opens any fold hiding it.
 */
export function Outline({
  text,
  cursorLine,
  onReveal,
  onClose,
}: {
  text: string
  cursorLine: number
  onReveal: (line: number) => void
  onClose: () => void
}): React.ReactElement {
  const items = useMemo(() => outlineOf(text), [text])
  const current = currentSection(items, cursorLine)
  // Indent relative to the note's own top level, so a note that starts at `##`
  // is not pushed a step to the right for nothing.
  const top = items.reduce((min, item) => Math.min(min, item.level), 6)

  return (
    <nav className="outline" aria-label="Outline">
      <header className="outline__head">
        <span>Outline</span>
        <button className="icon-btn outline__close" onClick={onClose} aria-label="Close outline">
          <Icon name="x" size={13} />
        </button>
      </header>
      {items.length === 0 ? (
        <p className="outline__empty">No headings yet. Start a line with # to make one.</p>
      ) : (
        <ol className="outline__list">
          {items.map((item, i) => (
            <li key={`${item.line}:${item.text}`}>
              <button
                className={`outline__item${i === current ? ' is-current' : ''}`}
                style={{ paddingLeft: `${8 + (item.level - top) * 12}px` }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onReveal(item.line)}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  )
}
