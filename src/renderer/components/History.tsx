import { useCallback, useEffect, useState } from 'react'
import type { SnapshotInfo } from '@shared/ipc-contract'
import { api } from '../api'

/**
 * Version history for one note.
 *
 * Lists stored versions newest first and shows the selected one read-only, so
 * you can check it is the right version before replacing what you have. The
 * content of a version is fetched only when selected - a list of thirty
 * versions of a long note would be megabytes for a list of timestamps.
 */

function when(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

const exact = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Props = {
  path: string
  onRestored: () => void
}

export function History({ path, onRestored }: Props): React.ReactElement {
  const [versions, setVersions] = useState<SnapshotInfo[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.invoke('history:list', path).then((list) => {
      setVersions(list)
      setSelected(list[0]?.id ?? null)
    })
  }, [path])

  useEffect(load, [load])

  useEffect(() => {
    if (selected === null) {
      setPreview(null)
      return
    }
    let cancelled = false
    void api.invoke('history:get', selected).then((snapshot) => {
      if (!cancelled) setPreview(snapshot?.content ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const restore = async (): Promise<void> => {
    if (selected === null) return
    const result = await api.invoke('history:restore', selected)
    if (!result.ok) {
      setNotice(result.error ?? 'Could not restore.')
      return
    }
    // Restoring is itself a change, so it gets snapshotted - the version you
    // replaced is now the newest entry and the restore can be undone.
    setNotice('Restored. The replaced version is now at the top of this list.')
    onRestored()
    load()
  }

  if (!versions) return <div className="pane-empty" />

  return (
    <div className="history">
      {versions.length === 0 ? (
        <p className="history__empty">
          No versions stored yet. One is kept each time the note changes, at most one a minute.
        </p>
      ) : (
        <>
          <ul className="history__list">
            {versions.map((version, i) => (
              <li key={version.id}>
                <button
                  className={`history__item${version.id === selected ? ' is-active' : ''}`}
                  onClick={() => setSelected(version.id)}
                  title={exact(version.ts)}
                >
                  <span className="history__when">
                    {when(version.ts)}
                    {i === 0 && <span className="history__badge">current</span>}
                  </span>
                  <span className="history__bytes">{version.bytes.toLocaleString()} bytes</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="history__preview">
            {notice !== null && (
              <p className="history__notice" onClick={() => setNotice(null)}>
                {notice}
              </p>
            )}
            <pre className="history__text">{preview ?? ''}</pre>
            <div className="history__actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={() => void restore()}
                disabled={selected === null || selected === versions[0]?.id}
              >
                Restore this version
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
