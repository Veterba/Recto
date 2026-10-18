import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import { bodyOf, parseFrontmatter, withBody } from '@shared/frontmatter'
import { checklist, dateOnly, readPriority, readTags, setCardField, setCardTags, PRIORITIES } from '@shared/card-fields'
import { api } from '../../../app/api'
import { useNoteBus } from '../../../app/note-bus'
import { Icon } from '../../../ui/Icon'
import { NoteBodyEditor } from '../../editor'
import type { Board } from '../boards'
import type { CardView } from '../board-view'
import type { Drop } from '../hooks/use-board-cards'

type Props = {
  board: Board
  card: CardView
  editCard: (path: string, edit: (text: string) => string) => Promise<boolean>
  move: (key: string, target: Drop) => Promise<void>
  /** Rename the card's note: its title is its file name. */
  onRename: (name: string) => Promise<void>
  /** A plain-text card becomes a note in tasks/. */
  onMakeNote: () => Promise<void>
  onOpenNote: (path: string) => void
  onClose: () => void
}

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

/** How long typing in the panel pauses before the note is written. */
const BODY_SAVE_MS = 500

/** The value of a frontmatter key as written, or null. */
const raw = (text: string, key: string): unknown => parseFrontmatter(text).fields.find((f) => f.key === key)?.value ?? null

/**
 * A card, opened beside the board. Its column is its line's place on this
 * board; every other field is the note's own frontmatter or text, read from
 * the file itself and written back one key at a time. A plain-text card has
 * no note: it offers to become one.
 */
export function CardPanel(props: Props): React.ReactElement {
  return props.card.light ? <LightCardPanel {...props} /> : <NoteCardPanel {...props} />
}

/** The column select: the lanes of the board on screen. */
function StatusSelect({ board, card, move }: Pick<Props, 'board' | 'card' | 'move'>): React.ReactElement {
  return (
    <select
      id="card-status"
      className="setting__select"
      value={card.column}
      onChange={(event) => void move(card.key, { column: event.target.value, index: Number.MAX_SAFE_INTEGER })}
    >
      {board.columns.map((column) => (
        <option key={column.id} value={column.id}>
          {column.name}
        </option>
      ))}
    </select>
  )
}

function LightCardPanel({ board, card, move, onMakeNote, onClose }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false)
  return (
    <aside className="card-panel glass-surface" aria-label={`Card: ${card.title}`}>
      <header className="card-panel__head">
        <code className="card-panel__path">Text on {board.name}</code>
        <button className="icon-btn" aria-label="Close card" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </header>
      <div className="card-panel__body">
        <p className="card-panel__title card-panel__title--text">{card.title}</p>
        <div className="card-panel__fields">
          <label htmlFor="card-status">Status</label>
          <StatusSelect board={board} card={card} move={move} />
        </div>
        {card.description !== '' && <p className="card-panel__desc">{card.description}</p>}
        <p className="card-panel__hint">A line of text on the board. As a note it can have a priority, dates, a tag and a checklist.</p>
        <button
          className="btn btn--sm card-panel__open"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onMakeNote().finally(() => setBusy(false))
          }}
        >
          <Icon name="file-plus" size={13} />
          Make it a note
        </button>
      </div>
    </aside>
  )
}

function NoteCardPanel({ board, card, editCard, move, onRename, onOpenNote, onClose }: Props): React.ReactElement {
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

  const priorityRaw = text === null ? card.priority : raw(text, 'priority')
  const level = readPriority(priorityRaw)
  const unknownPriority = level === null && typeof priorityRaw === 'string' && priorityRaw.trim() !== '' ? priorityRaw.trim() : null
  const start = dateOnly(text === null ? card.start : raw(text, 'start')) ?? ''
  const due = dateOnly(text === null ? card.due : raw(text, 'due')) ?? ''
  const tags = readTags(text === null ? card.tags : raw(text, 'tags'))
  const body = text === null ? '' : bodyOf(text)
  const items = checklist(body)

  /**
   * The note's text, typed in the panel: shown on the board as it is typed
   * (description, checklist), written once typing pauses.
   */
  const bodyTimer = useRef<number | undefined>(undefined)
  /** The write waiting for a pause - run at once if the panel closes first, so nothing typed is lost. */
  const pendingBody = useRef<(() => void) | null>(null)
  const writeBody = (next: string): void => {
    window.clearTimeout(bodyTimer.current)
    const write = (): void => {
      pendingBody.current = null
      void edit((t) => withBody(t, next))
    }
    pendingBody.current = write
    bodyTimer.current = window.setTimeout(write, BODY_SAVE_MS)
  }
  useEffect(
    () => () => {
      window.clearTimeout(bodyTimer.current)
      pendingBody.current?.()
    },
    [],
  )

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
          <StatusSelect board={board} card={card} move={move} />

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

        <section className="card-panel__section card-panel__notes" aria-label="Notes">
          <h3 className="card-panel__sub">
            Notes
            {items.length > 0 && (
              <span className="card-panel__count">
                {items.filter((i) => i.done).length}/{items.length} done
              </span>
            )}
          </h3>
          {text !== null && (
            <NoteBodyEditor
              docKey={card.path}
              value={body}
              placeholder="Notes, steps, links. Markdown works: “- [ ] ” starts a checklist item."
              onChange={writeBody}
              onOpenLink={(target) =>
                void api.invoke(IPC.indexResolveLink, target).then((found) => {
                  if (found !== null) onOpenNote(found)
                })
              }
            />
          )}
        </section>

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
