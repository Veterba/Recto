import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { Icon } from '../../../ui/Icon'
import { fromFileName, type ChatTopics, type LoadedTopic } from '../chat-topics-model'

/**
 * A bot's topics, newest first, searchable by title and by what was said.
 * Opening one makes it the current topic; each can be renamed or deleted.
 */

type Row = { path: string; title: string; created: string; text: string }

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** "2 Oct 2026, 15:30", from the topic's `created`. */
function when(created: string): string {
  const date = new Date(created)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function HistoryPanel({
  model,
  current,
  onJump,
  onDelete,
  onClose,
}: {
  model: ChatTopics
  current: string | null
  onJump: (path: string) => void
  onDelete: (path: string) => void
  onClose: () => void
}): React.ReactElement {
  const [all, setAll] = useState<LoadedTopic[] | null>(null)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<{ path: string; title: string } | null>(null)
  const [confirming, setConfirming] = useState<Row | null>(null)

  // Every topic, read once, so search can look inside them; again when the list changes.
  useEffect(() => {
    let cancelled = false
    void model.loadAll().then((topics) => {
      if (!cancelled) setAll(topics)
    })
    return () => {
      cancelled = true
    }
  }, [model, model.files])

  const rows: Row[] = useMemo(
    () =>
      model.files.map((path) => {
        const loaded = all?.find((t) => t.path === path)
        const name = fromFileName(basename(path))
        return {
          path,
          title: loaded?.meta.title ?? name.title,
          created: loaded?.meta.created ?? name.created,
          text: loaded?.messages.map((m) => m.content).join('\n') ?? '',
        }
      }),
    [model.files, all],
  )

  const needle = query.trim().toLowerCase()
  const shown =
    needle === '' ? rows : rows.filter((row) => row.title.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle))

  return (
    <aside className="bot-history glass-surface" aria-label="History">
      <div className="bot-history__head">
        <input
          className="bot-history__search"
          autoFocus
          placeholder="Search topics…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
          }}
        />
        <button className="bot-chat__action bot-chat__action--icon" aria-label="Close history" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul className="bot-history__list">
        {shown.map((row) => (
          <li key={row.path} className={`bot-history__row${row.path === current ? ' is-current' : ''}`}>
            {renaming?.path === row.path ? (
              <input
                className="bot-history__rename"
                autoFocus
                value={renaming.title}
                aria-label="Topic title"
                onChange={(event) => setRenaming({ path: row.path, title: event.target.value })}
                onBlur={() => setRenaming(null)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') setRenaming(null)
                  if (event.key === 'Enter') {
                    const next = renaming.title
                    setRenaming(null)
                    void model.retitle(row.path, next)
                  }
                }}
              />
            ) : (
              <button className="bot-history__open" onClick={() => onJump(row.path)}>
                <span className="bot-history__title">{row.title}</span>
                <span className="bot-history__when">{when(row.created)}</span>
              </button>
            )}
            <button
              className="bot-history__tool"
              aria-label={`Rename ${row.title}`}
              onClick={() => setRenaming({ path: row.path, title: row.title })}
            >
              <Icon name="pencil" size={13} />
            </button>
            <button
              className="bot-history__tool bot-history__tool--danger"
              aria-label={`Delete ${row.title}`}
              onClick={() => setConfirming(row)}
            >
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="bot-history__empty">{rows.length === 0 ? 'No topics yet.' : `No topic matches “${query.trim()}”.`}</li>
        )}
      </ul>

      {confirming !== null && (
        <ConfirmDialog
          title="Delete topic"
          body={
            <>
              <strong>{confirming.title}</strong> goes to the system trash. You can undo for a few seconds.
            </>
          }
          confirmLabel="Delete topic"
          onConfirm={() => {
            const path = confirming.path
            setConfirming(null)
            onDelete(path)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </aside>
  )
}
