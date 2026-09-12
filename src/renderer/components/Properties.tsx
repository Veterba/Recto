import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import {
  parseFrontmatter,
  removeField,
  renameField,
  setField,
  type Field,
  type FieldType,
} from '../core/frontmatter'

/**
 * Typed frontmatter, above the editor.
 *
 * The panel edits the note's own text - there is no separate store - so what
 * you see here and what is in the file cannot drift. Every change goes through
 * the tested pure functions in `core/frontmatter`, which is where the rule
 * lives that anything unrecognised is preserved untouched.
 *
 * This is also the data layer the Tasks board reads: a card's `status`,
 * `board` and `order` are just properties on a note.
 */

const TYPE_ICON: Record<FieldType, string> = {
  text: 'type',
  number: 'hash',
  boolean: 'toggle-left',
  list: 'tags',
  date: 'calendar',
  empty: 'minus',
}

/** Editing widget per type; text is the fallback for anything else. */
function ValueEditor({
  field,
  onChange,
}: {
  field: Field
  onChange: (value: Field['value']) => void
}): React.ReactElement {
  if (field.type === 'boolean') {
    return (
      <button
        className={`toggle toggle--sm${field.value === true ? ' is-on' : ''}`}
        role="switch"
        aria-checked={field.value === true}
        onClick={() => onChange(field.value !== true)}
      >
        <span className="toggle__knob" />
      </button>
    )
  }

  if (field.type === 'number') {
    return (
      <input
        className="prop__input"
        type="number"
        value={typeof field.value === 'number' ? field.value : ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <input
        className="prop__input"
        type="date"
        // The stored value may carry a time; the picker only wants the date.
        value={typeof field.value === 'string' ? field.value.slice(0, 10) : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (field.type === 'list') {
    const items = Array.isArray(field.value) ? field.value : []
    return (
      <input
        className="prop__input"
        value={items.join(', ')}
        placeholder="comma, separated"
        onChange={(event) => onChange(event.target.value.split(',').map((part) => part.trim()))}
      />
    )
  }

  return (
    <input
      className="prop__input"
      value={typeof field.value === 'string' ? field.value : ''}
      placeholder="empty"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

type Props = {
  /** The whole note text - frontmatter is part of the document. */
  text: string
  onChange: (next: string) => void
}

export function Properties({ text, onChange }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)

  const parsed = useMemo(() => parseFrontmatter(text), [text])
  const count = parsed.fields.length + parsed.opaque.length

  const addKey = (): void => {
    const key = newKey.trim()
    setAdding(false)
    setNewKey('')
    if (key === '' || parsed.fields.some((field) => field.key === key)) return
    // `null`, not `''`: an empty string serialises to `key: ""` whereas null
    // gives a bare `key:`, which is what a human would have typed.
    onChange(setField(text, key, null))
  }

  return (
    <section className={`props${collapsed ? ' is-collapsed' : ''}`}>
      <button className="props__head" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span className={`backlinks__chevron${collapsed ? '' : ' is-open'}`}>{'›'}</span>
        <span className="backlinks__title">Properties</span>
        <span className="backlinks__count">{count}</span>
      </button>

      {!collapsed && (
        <div className="props__body">
          {parsed.fields.map((field) => (
            <div className="prop" key={field.key}>
              <span className="prop__key" title={field.type}>
                <Icon name={TYPE_ICON[field.type]} size={13} />
                {renaming === field.key ? (
                  <input
                    className="prop__rename"
                    defaultValue={field.key}
                    autoFocus
                    onBlur={(event) => {
                      setRenaming(null)
                      const to = event.target.value.trim()
                      if (to !== '' && to !== field.key) onChange(renameField(text, field.key, to))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <button className="prop__keyname" onDoubleClick={() => setRenaming(field.key)}>
                    {field.key}
                  </button>
                )}
              </span>

              <ValueEditor field={field} onChange={(value) => onChange(setField(text, field.key, value))} />

              <button
                className="prop__remove"
                aria-label={`Remove ${field.key}`}
                onClick={() => onChange(removeField(text, field.key))}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}

          {parsed.opaque.length > 0 && (
            <div className="prop prop--opaque">
              <pre className="prop__opaque">{parsed.opaque.join('\n')}</pre>
              <span className="prop__opaque-note">
                Kept exactly as written — nested YAML is not edited here, so nothing is flattened.
              </span>
            </div>
          )}

          {adding ? (
            <div className="prop">
              <input
                className="prop__input prop__input--key"
                placeholder="property name"
                value={newKey}
                autoFocus
                onChange={(event) => setNewKey(event.target.value)}
                onBlur={addKey}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addKey()
                  if (event.key === 'Escape') {
                    setAdding(false)
                    setNewKey('')
                  }
                }}
              />
            </div>
          ) : (
            <button className="props__add" onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} />
              Add property
            </button>
          )}
        </div>
      )}
    </section>
  )
}
