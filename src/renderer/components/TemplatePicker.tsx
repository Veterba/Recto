import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { fuzzyFilter } from '../core/fuzzy'
import { isInFolder, TEMPLATE_FOLDER, templateName } from '../core/templates'
import { Highlight } from './CommandPalette'
import { Icon } from './Icon'

/**
 * Pick a template to insert.
 *
 * The same shape as the quick switcher and the command palette - one fuzzy
 * matcher, one list, arrows and Enter - because a third kind of picker in one
 * app is a third thing to learn for no reason.
 */

type Props = {
  /** Every note in the vault; templates are filtered out of it here. */
  notes: readonly string[]
  /** The vault's templates folder, from Settings → Templates. */
  folder: string
  onPick: (path: string) => void
  onClose: () => void
}

export function TemplatePicker({ notes, folder, onPick, onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => input.current?.focus(), [])

  const templates = useMemo(
    () => notes.filter((path) => path !== folder && isInFolder(path, folder)),
    [notes, folder],
  )

  const results = useMemo(
    () =>
      (query.trim() === ''
        ? templates.map((item) => ({ item, match: { score: 0, ranges: [] } }))
        : fuzzyFilter(query, templates, templateName)
      ).slice(0, 40),
    [query, templates],
  )

  useEffect(() => setCursor(0), [query])

  const choose = (index: number): void => {
    const hit = results[index]
    if (hit === undefined) return
    onPick(hit.item)
  }

  return createPortal(
    <div
      className="palette__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Insert template">
        <input
          ref={input}
          className="palette__input"
          placeholder={templates.length === 0 ? `No templates yet — add notes to ${folder}/` : 'Insert template…'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((c) => Math.min(results.length - 1, c + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((c) => Math.max(0, c - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(cursor)
            }
          }}
        />

        {templates.length === 0 ? (
          <p className="palette__empty">
            A template is just a note in <code>{folder}/</code>. Create one there and it
            appears here — <code>{'{{date}}'}</code>, <code>{'{{title}}'}</code> and{' '}
            <code>{'{{time}}'}</code> are filled in when you insert it.
          </p>
        ) : (
          <ul className="palette__list" role="listbox">
            {results.map((hit, index) => (
              <li
                key={hit.item}
                role="option"
                aria-selected={index === cursor}
                className={`palette__item${index === cursor ? ' is-cursor' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(index)
                }}
              >
                <Icon name="file-text" size={14} />
                <span className="palette__name">
                  <Highlight text={templateName(hit.item)} ranges={hit.match.ranges} />
                </span>
              </li>
            ))}
            {results.length === 0 && <li className="palette__empty">No template matches “{query}”.</li>}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Create a starter template, so the folder is never an empty room. */
export async function seedTemplate(): Promise<string | null> {
  const created = await api.invoke('fs:create', TEMPLATE_FOLDER, 'meeting.md', 'file')
  if (!created.ok) return null
  await api.invoke(
    'fs:write',
    created.path,
    ['# {{title}}', '', 'Date: {{date}} {{time}}', '', '## Attendees', '', '## Notes', '', '## Follow-up by {{date:+7}}', ''].join('\n'),
  )
  return created.path
}
