import { useLayoutEffect, useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { fuzzyFilter } from '../../../ui/fuzzy'
import { GlassMenu } from './GlassMenu'
import { ModelChip } from './ModelMenu'

/**
 * The composer: a glass capsule floating over the bottom of the conversation,
 * as wide as the message column - [+], the text, the model, Send. It grows
 * with the text to about eight lines, turning from a capsule into a rounded
 * card, then scrolls. What keeps Send off (no model, Ollama down, a model
 * loading) is one muted line just above it.
 *
 * Typing `[[` lists notes to link, as in the editor.
 */

export type NoteCandidate = { path: string; name: string; folder: string }

/** About eight lines of text, then the field scrolls. */
const MAX_HEIGHT = 8 * 22 + 16
/** Taller than one line: the capsule becomes a card. */
const ONE_LINE = 44

const OPEN_LINK = /\[\[([^\]\n]*)$/

type Props = {
  draft: string
  onDraft: (text: string) => void
  placeholder: string
  /** An answer is coming: Send is Stop. */
  busy: boolean
  /** The model can answer: Send works. */
  canSend: boolean
  onSend: () => void
  onStop: () => void
  onNewTopic: () => void
  status: React.ReactNode
  model: string
  modelMenu: (close: () => void) => React.ReactElement
  notes: () => readonly NoteCandidate[]
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onFocus: () => void
  onBlur: () => void
  /** For snapshots: a menu open from the start. */
  initialMenu?: 'plus' | 'model' | null
}

export function Composer(props: Props): React.ReactElement {
  const { draft, onDraft, busy, canSend, inputRef } = props
  const [menu, setMenu] = useState<'plus' | 'model' | null>(props.initialMenu ?? null)
  const [multi, setMulti] = useState(false)
  const [link, setLink] = useState<{ query: string; active: number } | null>(null)

  // Fit the field to its text: on typing, and when the draft is cleared on send.
  useLayoutEffect(() => {
    const field = inputRef.current
    if (field === null) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(MAX_HEIGHT, field.scrollHeight)}px`
    setMulti(field.scrollHeight > ONE_LINE)
  }, [draft, inputRef])

  const matches = link === null ? [] : fuzzyFilter(link.query, props.notes(), (n) => n.name).slice(0, 8)

  /** Look for an open `[[` before the caret. */
  const checkLink = (field: HTMLTextAreaElement): void => {
    const open = OPEN_LINK.exec(field.value.slice(0, field.selectionStart))
    setLink(open === null ? null : { query: open[1] ?? '', active: 0 })
  }

  const acceptLink = (name: string): void => {
    const field = inputRef.current
    if (field === null) return
    const caret = field.selectionStart
    const before = field.value.slice(0, caret).replace(OPEN_LINK, `[[${name}]]`)
    const after = field.value.slice(caret).replace(/^\]\]/, '')
    onDraft(before + after)
    setLink(null)
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(before.length, before.length)
    })
  }

  const send = (): void => {
    if (busy) props.onStop()
    else if (canSend && draft.trim() !== '') props.onSend()
  }

  return (
    <div className="composer">
      <div className="composer__inner">
        {props.status}
        {menu === 'plus' && (
          <GlassMenu
            className="plus-menu"
            label="Add"
            onClose={() => setMenu(null)}
            entries={[
              {
                kind: 'item',
                key: 'link',
                label: 'Link a note',
                mark: '[[',
                run: () => {
                  setMenu(null)
                  const field = inputRef.current
                  if (field === null) return
                  const caret = field.selectionStart
                  const next = `${draft.slice(0, caret)}[[${draft.slice(caret)}`
                  onDraft(next)
                  setLink({ query: '', active: 0 })
                  requestAnimationFrame(() => {
                    field.focus()
                    field.setSelectionRange(caret + 2, caret + 2)
                  })
                },
              },
              {
                kind: 'item',
                key: 'topic',
                label: 'New topic',
                mark: '+',
                right: '⌘N',
                run: () => {
                  setMenu(null)
                  props.onNewTopic()
                },
              },
            ]}
          />
        )}
        {menu === 'model' && props.modelMenu(() => setMenu(null))}
        {link !== null && matches.length > 0 && (
          <div className="glass-menu glass-surface link-menu" role="listbox" aria-label="Notes">
            {matches.map(({ item }, i) => (
              <button
                key={item.path}
                className={`glass-menu__item${i === link.active ? ' is-active' : ''}`}
                role="option"
                aria-selected={i === link.active}
                onMouseDown={(event) => {
                  event.preventDefault()
                  acceptLink(item.name)
                }}
              >
                <span className="glass-menu__label">
                  <b>{item.name}</b>
                  {item.folder !== '' && <span>{item.folder}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className={`composer__capsule glass-surface${multi ? ' is-multi' : ''}`}>
          <Tip label="Add" placement="top">
            <button
              className={`composer__plus${menu === 'plus' ? ' is-open' : ''}`}
              data-menu-anchor=""
              aria-haspopup="menu"
              aria-expanded={menu === 'plus'}
              onClick={() => setMenu((m) => (m === 'plus' ? null : 'plus'))}
            >
              <Icon name="plus" size={18} strokeWidth={2} />
            </button>
          </Tip>
          <textarea
            ref={inputRef}
            className="composer__input"
            rows={1}
            value={draft}
            placeholder={props.placeholder}
            aria-label="Message"
            onFocus={props.onFocus}
            onBlur={() => {
              props.onBlur()
              setLink(null)
            }}
            onChange={(event) => {
              onDraft(event.target.value)
              checkLink(event.target)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (link !== null && matches.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  setLink({ ...link, active: (link.active + step + matches.length) % matches.length })
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const pick = matches[link.active]
                  if (pick !== undefined) acceptLink(pick.item.name)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setLink(null)
                  return
                }
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!busy) send()
              }
              if (event.key === 'Escape' && busy) props.onStop()
            }}
            onSelect={(event) => checkLink(event.currentTarget)}
          />
          <ModelChip model={props.model} open={menu === 'model'} onToggle={() => setMenu((m) => (m === 'model' ? null : 'model'))} />
          <Tip label={busy ? 'Stop' : 'Send'} hint={busy ? 'Esc' : 'Enter · Shift+Enter for a new line'} placement="top">
            <button
              className={`composer__send${busy ? ' is-stop' : ''}`}
              aria-label={busy ? 'Stop' : 'Send'}
              disabled={!busy && (!canSend || draft.trim() === '')}
              onClick={send}
            >
              {busy ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2.5" />
                </svg>
              ) : (
                <Icon name="arrow-up" size={17} strokeWidth={2.3} />
              )}
            </button>
          </Tip>
        </div>
      </div>
    </div>
  )
}
