import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseFrontmatter, removeField, setField } from '@shared/frontmatter'
import { DESCRIPTION_KEY } from '@shared/property-types'

/**
 * The note's description, under its name, as Notion has one under a page's
 * title. It is the `description` property - plain YAML, read by Obsidian and
 * by search like any other - shown here and left out of the property rows.
 * "Add a description…" shows only on hover, so a note without one looks as it
 * did. One line, wrapped as it grows (a property holds one): written on blur
 * or Enter, dropped on Escape; emptied, the property goes.
 */
export function NoteDescription({ text, onChange }: { text: string; onChange: (next: string) => void }): React.ReactElement {
  const value = useMemo(() => {
    const field = parseFrontmatter(text).fields.find((f) => f.key === DESCRIPTION_KEY)
    return field === undefined || field.value === null ? '' : Array.isArray(field.value) ? field.value.join(', ') : String(field.value)
  }, [text])
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value
  const box = useRef<HTMLTextAreaElement | null>(null)

  // As tall as its text: one line when short, more as it wraps.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [shown])

  const commit = (): void => {
    if (draft === null) return
    const next = draft.replace(/\s*\n\s*/g, ' ').trim()
    setDraft(null)
    if (next === value) return
    onChange(next === '' ? removeField(text, DESCRIPTION_KEY) : setField(text, DESCRIPTION_KEY, next))
  }

  return (
    <div className={`note-description${shown === '' ? ' is-empty' : ''}`}>
      <textarea
        ref={box}
        className="note-description__input"
        aria-label="Description"
        placeholder="Add a description…"
        rows={1}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(null)
            const el = event.currentTarget
            requestAnimationFrame(() => el.blur())
          }
        }}
      />
    </div>
  )
}
