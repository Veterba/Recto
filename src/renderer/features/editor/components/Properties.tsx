import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../app/api'
import type { LinkCandidate } from '../link-complete'
import { TOPIC_PREFIX, TOPICS_PROPERTY } from '@shared/topics'
import { linksIn, writeLinks } from '@shared/link-property'
import { Icon } from '../../../ui/Icon'
import { LinkInput } from './LinkInput'
import { Tip } from '../../../ui/Tip'
import { parseFrontmatter, removeField, renameField, setField, splitItems, type Field } from '@shared/frontmatter'
import { convertValue, DESCRIPTION_KEY, emptyValue, KINDS, kindInfo, kindOf, type PropertyKind } from '@shared/property-types'
import { setPropertyType, usePropertyTypes } from '../property-types-store'
import { IPC } from '@shared/ipc'
import { Toggle } from '../../../ui/Toggle'
import { summary } from '../property-summary'

/**
 * Typed frontmatter, above the editor.
 *
 * The panel edits the note's own text - there is no separate store - so what
 * you see here and what is in the file cannot drift. Every change goes through
 * the tested pure functions in `shared/frontmatter.ts`, which is where the rule
 * lives that anything unrecognised is preserved untouched.
 *
 * This is also the data layer the Tasks board reads: a card's `status`,
 * `board` and `order` are just properties on a note.
 */

type Part = { kind: 'text'; text: string } | { kind: 'link'; target: string; heading: string | null; label: string }

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
  source,
}: {
  field: Field
  onChange: (value: Field['value']) => void
  onOpenLink: (target: string, heading: string | null) => void
  getCandidates: () => readonly LinkCandidate[]
  /** The note the properties are in: its links are read from there. */
  source: string
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
    void api.invoke(IPC.indexResolveLinks, targets, source).then((resolved) => {
      if (!cancelled) setUnresolved(new Set(targets.filter((target) => resolved[target] == null)))
    })
    return () => {
      cancelled = true
    }
    // Keyed on the joined targets, not the array identity, which is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, source])

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
        source={source}
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

/**
 * `topics`, as chips: the topic's name without the `topics/` it is stored
 * under, in the dashed style of anything the machine wrote. × takes the topic
 * off this note - and the machine never gives it back.
 */
function TopicChips({ links, onRemove }: { links: string[]; onRemove: (link: string) => void }): React.ReactElement {
  return (
    <div className="prop__topics">
      {links.map((link) => {
        const label = link.toLowerCase().startsWith(TOPIC_PREFIX) ? link.slice(TOPIC_PREFIX.length) : link
        return (
          <span className="prop__topic" key={link}>
            {label}
            <button className="prop__topic-x" aria-label={`Remove topic ${label}`} onClick={() => onRemove(link)}>
              <Icon name="x" size={10} />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/** Editing widget per kind; text is the fallback for anything else. */
function ValueEditor({
  field,
  kind,
  onChange,
  onOpenLink,
  getCandidates,
  source,
}: {
  field: Field
  kind: PropertyKind
  onChange: (value: Field['value']) => void
  onOpenLink: (target: string, heading: string | null) => void
  getCandidates: () => readonly LinkCandidate[]
  /** The note the properties are in: its links are read from there. */
  source: string
}): React.ReactElement {
  const linked = kind === 'link' || (kind === 'list' && Array.isArray(field.value) && field.value.some((item) => HAS_LINK.test(item)))
  if (linked) return <LinkValue field={field} onChange={onChange} onOpenLink={onOpenLink} getCandidates={getCandidates} source={source} />

  if (kind === 'checkbox') {
    return <Toggle on={field.value === true} onChange={() => onChange(field.value !== true)} small />
  }

  if (kind === 'number') {
    return <NumberDraft value={typeof field.value === 'number' ? field.value : null} onChange={onChange} />
  }

  if (kind === 'date') {
    return (
      <input
        className="prop__input"
        type="date"
        // The stored value may carry a time; the picker only wants the date.
        value={typeof field.value === 'string' ? field.value.slice(0, 10) : ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
    )
  }

  if (kind === 'list') {
    const items = Array.isArray(field.value) ? field.value : typeof field.value === 'string' && field.value !== '' ? [field.value] : []
    return (
      <TextDraft
        value={items.join(', ')}
        placeholder="Empty"
        getCandidates={getCandidates}
        source={source}
        onCommit={(next) => onChange(next.trim() === '' ? null : splitItems(next))}
      />
    )
  }

  const text = typeof field.value === 'string' ? field.value : field.value === null ? '' : String(field.value)
  if (kind === 'url' || kind === 'email') return <AddressDraft kind={kind} value={text} onChange={onChange} />

  return (
    <TextDraft
      value={text}
      placeholder="Empty"
      getCandidates={getCandidates}
      source={source}
      onCommit={(next) => onChange(next === '' ? null : next)}
    />
  )
}

/** A web address or an email: typed as text, opened with the button beside it. */
function AddressDraft({ kind, value, onChange }: { kind: 'url' | 'email'; value: string; onChange: (value: Field['value']) => void }): React.ReactElement {
  const draft = useDraft(value, (next) => onChange(next.trim() === '' ? null : next.trim()))
  const target = kind === 'email' ? `mailto:${value}` : /^https?:\/\//i.test(value) ? value : `https://${value}`
  return (
    <span className="prop__address">
      <input
        className="prop__input"
        type={kind === 'email' ? 'email' : 'url'}
        value={draft.shown}
        placeholder="Empty"
        onChange={(event) => draft.setDraft(event.target.value)}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
      />
      {value !== '' && (
        <Tip label={kind === 'email' ? `Write to ${value}` : `Open ${value}`}>
          <button className="prop__open" aria-label={kind === 'email' ? 'Write an email' : 'Open the address'} onClick={() => void api.invoke(IPC.shellOpenExternal, target)}>
            <Icon name={kind === 'email' ? 'at-sign' : 'external-link'} size={12} />
          </button>
        </Tip>
      )}
    </span>
  )
}

/** The kinds a property can be, to pick one: for a new property, or from a property's icon. */
function KindMenu({ current, onPick, onClose }: { current: PropertyKind | null; onPick: (kind: PropertyKind) => void; onClose: () => void }): React.ReactElement {
  return (
    <div
      className="prop-kinds"
      role="menu"
      aria-label="Property type"
      tabIndex={-1}
      ref={(el) => el?.focus()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      {KINDS.map((k) => (
        <button key={k.kind} role="menuitem" className={`prop-kinds__item${k.kind === current ? ' is-current' : ''}`} onClick={() => onPick(k.kind)}>
          <Icon name={k.icon} size={13} />
          {k.label}
        </button>
      ))}
    </div>
  )
}

/**
 * What is typed in a value, kept here until it is done: written on blur or
 * Enter, dropped on Escape. Null while nothing is being typed, so a change made
 * elsewhere (a board, another app) shows at once.
 *
 * It used to be written on every key: each key rewrote the note, and the value
 * was trimmed as it went - `in progress` lost its space.
 */
function useDraft<T>(value: T, commit: (next: T) => void) {
  const [draft, setDraft] = useState<T | null>(null)
  return {
    shown: draft ?? value,
    setDraft,
    onBlur: (): void => {
      if (draft !== null && draft !== value) commit(draft)
      setDraft(null)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>): void => {
      // On a Mac, Home and End in a field scroll the page: the note scrolled
      // away, its properties left the screen and took the field with them.
      if ((event.key === 'Home' || event.key === 'End') && !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) {
        event.preventDefault()
        const at = event.key === 'Home' ? 0 : event.currentTarget.value.length
        event.currentTarget.setSelectionRange(at, at)
      }
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') {
        setDraft(null)
        // Blurred after the draft is gone, so nothing is written.
        const field = event.currentTarget
        requestAnimationFrame(() => field.blur())
      }
    },
  }
}

function TextDraft({
  value,
  placeholder,
  getCandidates,
  source,
  onCommit,
}: {
  value: string
  placeholder: string
  getCandidates: () => readonly LinkCandidate[]
  source: string
  onCommit: (next: string) => void
}): React.ReactElement {
  const draft = useDraft(value, onCommit)
  return (
    <LinkInput
      className="prop__input"
      value={draft.shown}
      placeholder={placeholder}
      getCandidates={getCandidates}
      source={source}
      onChange={draft.setDraft}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  )
}

function NumberDraft({ value, onChange }: { value: number | null; onChange: (value: Field['value']) => void }): React.ReactElement {
  const draft = useDraft(value === null ? '' : String(value), (next) => onChange(next === '' ? null : Number(next)))
  return (
    <input
      className="prop__input"
      type="number"
      value={draft.shown}
      onChange={(event) => draft.setDraft(event.target.value)}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
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
  /** The note's path: links in its properties are read from there. */
  path: string
}

export function Properties({ text, onChange, onOpenLink, getLinkCandidates, path }: Props): React.ReactElement {
  /**
   * Shut until it is opened.
   *
   * It used to open itself on every note, so a header, a table and an "Add
   * property" button stood between the title and the first line of the text -
   * on a daily note, a third of the window spent on one `Link:` field. The
   * count in the header says whether there is anything in there worth opening.
   */
  const [collapsed, setCollapsed] = useState(true)
  /** Adding a property: first its type is picked (`picking`), then it is named. */
  const [adding, setAdding] = useState<'picking' | PropertyKind | null>(null)
  const [newKey, setNewKey] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  /** The property whose type menu is open. */
  const [retyping, setRetyping] = useState<string | null>(null)
  const types = usePropertyTypes()

  const parsed = useMemo(() => parseFrontmatter(text), [text])
  // The description is shown under the title (NoteDescription), not as a row.
  const fields = parsed.fields.filter((field) => field.key !== DESCRIPTION_KEY)
  const count = fields.length + parsed.opaque.length
  const kindFor = (field: Field): PropertyKind => kindOf(field, types.own, types.obsidian)

  const addKey = (): void => {
    const key = newKey.trim()
    const kind = adding === null || adding === 'picking' ? 'text' : adding
    setAdding(null)
    setNewKey('')
    // Nothing typed on a note with no properties: back to the faint line.
    if (key === '' && count === 0) setCollapsed(true)
    if (key === '' || parsed.fields.some((field) => field.key === key)) return
    // Its type is the vault's from now on, as Obsidian keeps one per name. Empty: a bare `key:`
    // (null, not `''`, which would be `key: ""`), what a human would have typed.
    if (kind !== 'text' || types.own[key] !== undefined) setPropertyType(key, kind)
    onChange(setField(text, key, emptyValue(kind)))
  }

  const retype = (field: Field, kind: PropertyKind): void => {
    setRetyping(null)
    setPropertyType(field.key, kind)
    const value = convertValue(field.value, kind)
    if (JSON.stringify(value) !== JSON.stringify(field.value)) onChange(setField(text, field.key, value))
  }

  return (
    <section className={`props${collapsed ? ' is-collapsed' : ''}`}>
      {count === 0 && collapsed ? (
        <button
          className="props__head"
          onClick={() => {
            // Straight to the type menu: there is no table yet to open.
            setCollapsed(false)
            setAdding('picking')
          }}
        >
          <Icon name="plus" size={12} />
          <span className="props__summary">Add property</span>
        </button>
      ) : (
        <button className="props__head" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <span className={`props__chevron${collapsed ? '' : ' is-open'}`}>{'›'}</span>
          <span className="props__summary">
            {fields.map((field, i) => (
              <span key={field.key}>
                {i > 0 && <span className="props__dot"> · </span>}
                <span className="props__key">{field.key}</span> {summary(field.value)}
              </span>
            ))}
            {fields.length === 0 && 'Properties'}
          </span>
        </button>
      )}

      {!collapsed && (
        <div className="props__body">
          {fields.map((field) => (
            <div className="prop" key={field.key}>
              <span className="prop__key">
                <Tip label={`${kindInfo(kindFor(field)).label} · change type`} placement="right">
                  <button className="prop__type" aria-label={`Type of ${field.key}`} onClick={() => setRetyping(retyping === field.key ? null : field.key)}>
                    <Icon name={kindInfo(kindFor(field)).icon} size={13} />
                  </button>
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

              {field.key === TOPICS_PROPERTY ? (
                <TopicChips
                  links={linksIn(text, TOPICS_PROPERTY)}
                  onRemove={(link) =>
                    onChange(
                      writeLinks(
                        text,
                        TOPICS_PROPERTY,
                        linksIn(text, TOPICS_PROPERTY).filter((l) => l !== link),
                      ),
                    )
                  }
                />
              ) : (
                <ValueEditor
                  field={field}
                  kind={kindFor(field)}
                  onChange={(value) => onChange(setField(text, field.key, value))}
                  onOpenLink={onOpenLink}
                  getCandidates={getLinkCandidates}
                  source={path}
                />
              )}

              <Tip label={`Remove “${field.key}”`}>
                <button className="prop__remove" aria-label={`Remove ${field.key}`} onClick={() => onChange(removeField(text, field.key))}>
                  <Icon name="x" size={12} />
                </button>
              </Tip>
              {/* Under the row, across it: the panel scrolls, and a menu floating out of it would be cut. */}
              {retyping === field.key && <KindMenu current={kindFor(field)} onPick={(kind) => retype(field, kind)} onClose={() => setRetyping(null)} />}
            </div>
          ))}

          {parsed.opaque.length > 0 && (
            <div className="prop prop--opaque">
              <pre className="prop__opaque">{parsed.opaque.join('\n')}</pre>
              <span className="prop__opaque-note">Kept exactly as written — nested YAML is not edited here, so nothing is flattened.</span>
            </div>
          )}

          {adding === 'picking' ? (
            <div className="prop prop--adding">
              <KindMenu
                current={null}
                onPick={(kind) => {
                  setAdding(kind)
                  setNewKey(kindInfo(kind).label)
                }}
                onClose={() => {
                  setAdding(null)
                  if (count === 0) setCollapsed(true)
                }}
              />
            </div>
          ) : adding !== null ? (
            <div className="prop">
              <span className="prop__key">
                <span className="prop__type">
                  <Icon name={kindInfo(adding).icon} size={13} />
                </span>
                <input
                  className="prop__input prop__input--key"
                  aria-label="Property name"
                  placeholder="Property name"
                  value={newKey}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setNewKey(event.target.value)}
                  onBlur={addKey}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addKey()
                    if (event.key === 'Escape') {
                      setAdding(null)
                      setNewKey('')
                    }
                  }}
                />
              </span>
            </div>
          ) : (
            <button className="props__add" onClick={() => setAdding('picking')}>
              <Icon name="plus" size={13} />
              Add a property
            </button>
          )}
        </div>
      )}
    </section>
  )
}
