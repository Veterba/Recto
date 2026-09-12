import { useCallback, useEffect, useState } from 'react'
import type { ArchiveState } from '@shared/ipc-contract'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { registerView } from '../core/view-registry'

/**
 * The archive: everything you have deleted that has not expired yet.
 *
 * Deletion is two-stage, so this screen has to make both stages legible - how
 * long each item has left, and that "delete now" still only means the OS trash.
 */

const DAY_MS = 86_400_000

const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 10, label: '10 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'Forever' },
]

function daysLeft(deletedAt: number, retentionDays: number): string {
  if (retentionDays === 0) return 'kept'
  const remaining = Math.ceil((deletedAt + retentionDays * DAY_MS - Date.now()) / DAY_MS)
  if (remaining <= 0) return 'due'
  return remaining === 1 ? '1 day left' : `${remaining} days left`
}

function ago(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function Archive(): React.ReactElement {
  const [state, setState] = useState<ArchiveState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.invoke('archive:list').then(setState)
  }, [])

  useEffect(load, [load])

  const restore = async (id: string): Promise<void> => {
    setBusy(id)
    const result = await api.invoke('archive:restore', id)
    setBusy(null)
    if (!result.ok) setError(result.error)
    else load()
  }

  const purge = async (id: string): Promise<void> => {
    setBusy(id)
    const result = await api.invoke('archive:purge', id)
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'Could not delete.')
    else load()
  }

  if (!state) return <div className="pane-empty" />

  return (
    <div className="archive">
      <header className="archive__head">
        <h2 className="archive__title">Archive</h2>
        <p className="archive__lede">
          Deleted notes wait here, then go to the system trash — recoverable in Finder even after
          that. Nothing is permanently destroyed by this app.
        </p>

        <div className="archive__retention">
          <span className="archive__retention-label">Keep for</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              className={`chip${state.retentionDays === preset.days ? ' is-active' : ''}`}
              onClick={() => void api.invoke('archive:set-retention', preset.days).then(setState)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </header>

      {error !== null && (
        <p className="tree__error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {state.entries.length === 0 ? (
        <p className="archive__empty">Nothing deleted. The archive is empty.</p>
      ) : (
        <ul className="archive__list">
          {state.entries.map((entry) => (
            <li key={entry.id} className={`archive__item${busy === entry.id ? ' is-busy' : ''}`}>
              <Icon name={entry.kind === 'folder' ? 'folder-plus' : 'file-plus'} size={15} />
              <span className="archive__name">{entry.name.replace(/\.md$/, '')}</span>
              <span className="archive__path">{entry.originalPath}</span>
              <span className="archive__meta">
                {ago(entry.deletedAt)} · {daysLeft(entry.deletedAt, state.retentionDays)}
              </span>
              <span className="archive__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => void restore(entry.id)}>
                  Restore
                </button>
                <button className="btn btn--ghost btn--sm btn--danger" onClick={() => void purge(entry.id)}>
                  Delete now
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function registerArchiveView(): () => void {
  return registerView({
    type: 'archive',
    title: 'Archive',
    icon: 'archive',
    render: () => <Archive />,
  })
}
