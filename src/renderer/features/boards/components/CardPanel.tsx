import { useCallback, useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import { bodyOf, parseFrontmatter } from '@shared/frontmatter'
import {
  cardDescription,
  checklist,
  dateOnly,
  readPriority,
  readTags,
  setCardField,
  setCardTags,
  toggleCheck,
  PRIORITIES,
} from '@shared/card-fields'
import { api } from '../../../app/api'
import { useNoteBus } from '../../../app/note-bus'
import { Icon } from '../../../ui/Icon'
import { UNKNOWN_COLUMN, type Board } from '../boards'
import type { CardView } from '../board-view'
import type { Drop } from '../hooks/use-board-cards'

type Props = {
  board: Board
  card: CardView
  editCard: (path: string, edit: (text: string) => string) => Promise<boolean>
  move: (path: string, target: Drop) => Promise<void>
  /** Rename the card's note: its title is its file name. */
  onRename: (name: string) => Promise<void>
  onOpenNote: (path: string) => void
  onClose: () => void
}

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

/** The value of a frontmatter key as written, or null. */
const raw = (text: string, key: string): unknown => parseFrontmatter(text).fields.find((f) => f.key === key)?.value ?? null

/**
 * A card, opened beside the board. Every field is the note's own frontmatter
 * or text, read from the file itself and written back one key at a time; the
 * board stays where it was.
 */
export function CardPanel({ board, card, editCard, move, onRename, onOpenNote, onClose }: Props): React.ReactElement {
  const [text, setText] = useState<string | null>(null)
  const [dateError, setDateError] = useState(false)
  const { revision } = useNoteBus()

  const read = useCallback(() => {
    void api.invoke(IPC.fsRead, card.path).then((result) => setText(result.ok ? result.content : null))
  }, [card.path])
  useEffect(read, [read, revision])

  /**
   * One edit to the note: shown here and on the board at once, then written.
   * A failed write is undone on the board by `editCard`, and here by reading
   * the file again, which still says what it said.
   */
  const edit = async (change: (text: string) => string): Promise<void> => {
    setText((current) => (current === null ? current : change(current)))
    if (!(await editCard(card.path, change))) read()
  }

  const status = card.column === UNKNOWN_COLUMN ? (card.status ?? '') : card.column
  const priorityRaw = text === null ? card.priority : raw(text, 'priority')
  const level = readPriority(priorityRaw)
  const unknownPriority = level === null && typeof priorityRaw === 'string' && priorityRaw.trim() !== '' ? priorityRaw.trim() : null
  const start = dateOnly(text === null ? card.start : raw(text, 'start')) ?? ''
  const due = dateOnly(text === null ? card.due : raw(text, 'due')) ?? ''
  const tags = readTags(text === null ? card.tags : raw(text, 'tags'))
  const body = text === null ? '' : bodyOf(text)
  const items = checklist(body)
  const description = text === null ? card.description : cardDescription(body)

  /** A date edit, refused while it would put the start after the due date. */
  const setDate = (key: 'start' | 'due', value: string): void => {
    const nextStart = key === 'start' ? value : start
    const nextDue = key === 'due' ? value : due
    if (nextStart !== '' && nextDue !== '' && nextStart > nextDue) {
      setDateError(true)
      return
    }
    setDateError(false)
    void edit((t) => setCardField(t, key, value === '' ? null : value))
  }

  return (
    <aside className="card-panel glass-surface" aria-label={`Card: ${card.title}`}>
      <header className="card-panel__head">
        <code className="card-panel__path">{card.path}</code>
        <button className="icon-btn" aria-label="Close card" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className="card-panel__body">
        <input
          key={card.title}
          className="card-panel__title"
          defaultValue={card.title}
          aria-label="Card title"
          spellCheck={false}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name === '' || name === card.title) {
              event.target.value = card.title
              return
            }
            void onRename(name)
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = card.title
              event.currentTarget.blur()
            }
          }}
        />

        <div className="card-panel__fields">
          <label htmlFor="card-status">Status</label>
          <select
            id="card-status"
            className="setting__select"
            value={status}
            onChange={(event) => void move(card.path, { column: event.target.value, index: Number.MAX_SAFE_INTEGER })}
          >
            {card.column === UNKNOWN_COLUMN && (
              <option value={status} disabled>
                {status} (no column)
              </option>
            )}
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>

          <label htmlFor="card-priority">Priority</label>
          <select
            id="card-priority"
            className="setting__select"
            value={level ?? unknownPriority ?? ''}
            onChange={(event) => {
              // Read now: by the time the edit runs, the select has been put back to what the file says.
              const value = event.target.value
              void edit((t) => setCardField(t, 'priority', value === '' ? null : value))
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {LEVEL_LABEL[p]}
              </option>
            ))}
            {unknownPriority !== null && <option value={unknownPriority}>{unknownPriority}</option>}
            <option value="">No priority</option>
          </select>

          <span>Dates</span>
          <span className="card-panel__dates">
            <input
              type="date"
              aria-label="Start"
              value={start}
              max={due === '' ? undefined : due}
              onChange={(event) => setDate('start', event.target.value)}
            />
            <span aria-hidden="true">→</span>
            <input
              type="date"
              aria-label="Due"
              value={due}
              min={start === '' ? undefined : start}
              onChange={(event) => setDate('due', event.target.value)}
            />
          </span>
          {dateError && <p className="card-panel__error">The start can't be after the due date. Not saved.</p>}

          <label htmlFor="card-tag">Tag</label>
          <input
            id="card-tag"
            key={tags[0] ?? ''}
            className="dialog__input card-panel__tag"
            defaultValue={tags[0] ?? ''}
            placeholder="Add a tag"
            spellCheck={false}
            onBlur={(event) => {
              const value = event.target.value.trim().replace(/^#/, '')
              if (value === (tags[0] ?? '')) return
              void edit((t) => setCardTags(t, value === '' ? tags.slice(1) : [value, ...tags.slice(1)]))
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = tags[0] ?? ''
                event.currentTarget.blur()
              }
            }}
          />
        </div>

        {description !== '' && <p className="card-panel__desc">{description}</p>}

        {items.length > 0 && (
          <section className="card-panel__section" aria-label="Checklist">
            <h3 className="card-panel__sub">
              Checklist · {items.filter((i) => i.done).length}/{items.length}
            </h3>
            <ul className="card-panel__checks">
              {items.map((item, index) => (
                <li key={index}>
                  <label className={`card-panel__check${item.done ? ' is-done' : ''}`}>
                    <input type="checkbox" checked={item.done} onChange={() => void edit((t) => toggleCheck(t, index))} />
                    <span>{item.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button className="btn btn--sm card-panel__open" onClick={() => onOpenNote(card.path)}>
          <Icon name="file-text" size={13} />
          Open as note
        </button>

        <section className="card-panel__section card-panel__later" aria-label="Comments">
          <h3 className="card-panel__sub">Comments — later</h3>
          <p>Comments and co-authors come with shared vaults.</p>
        </section>
      </div>
    </aside>
  )
}
