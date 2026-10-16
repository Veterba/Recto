import { useState } from 'react'
import { Icon } from './Icon'
import { highlightParts, matchesQuery, useSettingSearch } from './setting-search'

/** Text with the words being searched for marked. */
function Marked({ text, query }: { text: string; query: string }): React.ReactElement {
  if (query === '') return <>{text}</>
  return <>{highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}</>
}

/**
 * One setting: its label and hint on the left, its control on the right.
 *
 * `more` is the long explanation, behind an ⓘ after the hint. `disabled` is a
 * setting whose parent is off: still shown, so you can see what turning the
 * parent on would give you, but dim and out of reach - the fieldset disables
 * every control inside at once. While Settings is being searched, a row that
 * does not match hides itself.
 */
export function SettingRow({
  label,
  badge,
  hint,
  more,
  disabled,
  stack,
  children,
}: {
  label: string
  badge?: string
  hint?: string
  more?: React.ReactNode
  disabled?: boolean
  /** The control under the text rather than beside it, for a text area. */
  stack?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const query = useSettingSearch()
  const [open, setOpen] = useState(false)
  const hidden = query !== '' && !matchesQuery(`${label} ${hint ?? ''}`, query)
  return (
    <div
      className={`setting${stack === true ? ' setting--stack' : ''}${disabled === true ? ' is-disabled' : ''}`}
      hidden={hidden}
      aria-disabled={disabled === true ? true : undefined}
    >
      <div className="setting__text">
        <span className="setting__label">
          <Marked text={label} query={query} />
          {badge !== undefined && <span className="setting__badge">{badge}</span>}
        </span>
        {(hint !== undefined || more !== undefined) && (
          <span className="setting__hint">
            {hint !== undefined && <Marked text={hint} query={query} />}
            {more !== undefined && (
              <button
                className="setting__more"
                aria-expanded={open}
                aria-label={open ? `Less about ${label}` : `More about ${label}`}
                onClick={() => setOpen(!open)}
              >
                <Icon name="info" size={12} />
              </button>
            )}
          </span>
        )}
        {more !== undefined && open && <div className="setting__more-text">{more}</div>}
      </div>
      <fieldset className="setting__control" disabled={disabled === true}>
        {children}
      </fieldset>
    </div>
  )
}
