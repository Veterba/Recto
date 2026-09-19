import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { LinkCandidate } from '../editor/link-complete'
import { Icon } from './Icon'
import { LinkInput } from './LinkInput'
import { Tip } from './Tip'
import {
  parseFrontmatter,
  removeField,
  renameField,
  setField,
  splitItems,
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
  link: 'link',
  empty: 'minus',
}

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'link'; target: string; heading: string | null; label: string }

const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g
const HAS_LINK = /\[\[[^\]]+\]\]/

/**
 * A property value that holds links, shown as links.
 *
 * Read mode renders each `[[target]]` as a button that opens the note - the
 * reason to put a link in a property at all - with any plain list items beside
 * them as text. Clicking the empty part of the row switches to the raw text for
 * editing, because a link you can only click and never change is a link you
 * delete and retype.
 *
 * A link to nothing is drawn dashed, the same as in the editor, so a property
 * pointing at a renamed or deleted note is visible without opening anything.
 */
function LinkValue({
  field,
  onChange,
  onOpenLink,
  getCandidates,
}: {
  field: Field
  onChange: (value: Field['value']) => void
  onOpenLink: (target: string, heading: string | null) => void
  getCandidates: () => readonly LinkCandidate[]
}): React.ReactElement {
  const isList = Array.isArray(field.value)
  const raw = isList ? (field.value as string[]).join(', ') : typeof field.value === 'string' ? field.value : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(raw)
  const [unresolved, setUnresolved] = useState<ReadonlySet<string>>(new Set())

  const parts = useMemo((): Part[] => {
    const items = isList ? (field.value as string[]) : [raw]
    return items.flatMap((item): Part[] => {
      const links = [...item.matchAll(WIKILINK)]
      if (links.length === 0) return item.trim() === '' ? [] : [{ kind: 'text', text: item.trim() }]
      return links.map((match): Part => ({
        kind: 'link',
        target: (match[1] ?? '').trim(),
        heading: match[2]?.slice(1).trim() ?? null,
        label: (match[3]?.slice(1) ?? match[1] ?? '').trim(),
      }))
    })
  }, [field.value, isList, raw])

  const targets = parts.flatMap((part): string[] => (part.kind === 'link' ? [part.target] : []))
  const targetKey = targets.join('\n')
  useEffect(() => {
    if (targets.length === 0) return
    let cancelled = false
    void api.invoke('index:resolve-links', targets).then((resolved) => {
      if (!cancelled) setUnresolved(new Set(targets.filter((target) => resolved[target] == null)))
    })
    return () => {
      cancelled = true
    }
    // Keyed on the joined targets, not the array identity, which is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  const commit = (): void => {
    setEditing(false)
    if (draft === raw) return
    onChange(isList ? splitItems(draft) : draft)
  }

  if (editing) {
    return (
      <LinkInput
        className="prop__input"
        value={draft}
        autoFocus
        getCandidates={getCandidates}
        placeholder="[[Note name]]"
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(raw)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className="prop__links"
      role="button"
      tabIndex={0}
      aria-label="Edit value"
      onClick={() => {
        setDraft(raw)
        setEditing(true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          setDraft(raw)
          setEditing(true)
        }
      }}
    >
      {parts.map((part, index) =>
        part.kind === 'link' ? (
          <button
            key={index}
            className={`prop__link${unresolved.has(part.target) ? ' is-unresolved' : ''}`}
            title={unresolved.has(part.target) ? `No note called “${part.target}” yet` : `Open ${part.target}`}
            onClick={(event) => {
              // The row's own click means "edit"; the link's means "go".
              event.stopPropagation()
              onOpenLink(part.target, part.heading)
            }}
          >
            {part.label}
          </button>
        ) : (
          <span key={index} className="prop__plain">
            {part.text}
          </span>
        ),
      )}
    </div>
  )
}

/** Editing widget per type; text is the fallback for anything else. */
function ValueEditor({
  field,
  onChange,
  onOpenLink,
  getCandidates,
}: {
  field: Field
  onChange: (value: Field['value']) => void
  onOpenLink: (target: string, heading: string | null) => void
  getCandidates: () => readonly LinkCandidate[]
}): React.ReactElement {
  const linked =
    field.type === 'link' || (field.type === 'list' && Array.isArray(field.value) && field.value.some((item) => HAS_LINK.test(item)))
  if (linked) return <LinkValue field={field} onChange={onChange} onOpenLink={onOpenLink} getCandidates={getCandidates} />

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
      <LinkInput
        className="prop__input"
        value={items.join(', ')}
        placeholder="comma, separated"
        getCandidates={getCandidates}
        onChange={(next) => onChange(splitItems(next))}
      />
    )
  }

  return (
    <LinkInput
      className="prop__input"
      value={typeof field.value === 'string' ? field.value : ''}
      placeholder="empty — type [[ to link a note"
      getCandidates={getCandidates}
      onChange={(next) => onChange(next)}
    />
  )
}

type Props = {
  /** The whole note text - frontmatter is part of the document. */
  text: string
  onChange: (next: string) => void
  /** Follow a `[[link]]` held in a property value. */
  onOpenLink: (target: string, heading: string | null) => void
  /** Note names offered after `[[` in a value. */
  getLinkCandidates: () => readonly LinkCandidate[]
}

export function Properties({ text, onChange, onOpenLink, getLinkCandidates }: Props): React.ReactElement {
  /**
   * Shut until it is opened.
   *
   * It used to open itself on every note, so a header, a table and an "Add
   * property" button stood between the title and the first line of the text -
   * on a daily note, a third of the window spent on one `Link:` field. The
   * count in the header says whether there is anything in there worth opening.
   */
  const [collapsed, setCollapsed] = useState(true)
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
              <span className="prop__key">
                <Tip label={`${field.type} property`} placement="right">
                  <span className="prop__type">
                    <Icon name={TYPE_ICON[field.type]} size={13} />
                  </span>
                </Tip>
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
                  <Tip label={field.key} hint="Double-click to rename" placement="right">
                    <button className="prop__keyname" onDoubleClick={() => setRenaming(field.key)}>
                      {field.key}
                    </button>
                  </Tip>
                )}
              </span>

              <ValueEditor
                field={field}
                onChange={(value) => onChange(setField(text, field.key, value))}
                onOpenLink={onOpenLink}
                getCandidates={getLinkCandidates}
              />

              <Tip label={`Remove “${field.key}”`}>
                <button
                  className="prop__remove"
                  aria-label={`Remove ${field.key}`}
                  onClick={() => onChange(removeField(text, field.key))}
                >
                  <Icon name="x" size={12} />
                </button>
              </Tip>
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
