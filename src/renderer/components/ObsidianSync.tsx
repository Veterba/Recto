import { useEffect, useState } from 'react'
import type { ObsidianSyncStatus, ObsidianVaultInfo, SyncCounts, SyncProblem } from '@shared/ipc-contract'
import { api } from '../api'
import { edited } from '../core/note-preview'
import { Icon } from './Icon'

/**
 * Settings → Obsidian: keep this vault and an Obsidian vault in sync, both ways.
 *
 * Deliberately a screen you go to, not a prompt that appears on launch: pairing
 * two folders full of someone's notes is a decision, and it is made once, here,
 * after seeing what will happen.
 *
 * The order of the screen is the order of trust: pick a folder, see exactly
 * what the first pass would do, then start. Nothing is written until "Start".
 */

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function describeProblem(problem: SyncProblem): string {
  switch (problem.reason) {
    case 'missing':
      return problem.side === 'obsidian'
        ? 'The Obsidian folder cannot be found - on a drive that is not connected, or moved. Sync is paused and nothing was changed.'
        : 'This vault’s folder cannot be found. Sync is paused and nothing was changed.'
    case 'nested':
      return 'One vault is inside the other. Syncing them would copy the vault into itself, so it is refused.'
    case 'guard':
      return `Sync stopped before deleting ${plural(problem.count, 'file', 'files')} in ${
        problem.side === 'recto' ? 'Recto' : 'Obsidian'
      } at once. That usually means a folder was moved or emptied by mistake. If you really deleted them, sync anyway - deletions still go to ${
        problem.side === 'recto' ? 'Recto’s archive' : 'Obsidian’s trash'
      }.`
    case 'error':
      return `Sync failed: ${problem.message}`
  }
}

function Counts({ counts, first }: { counts: SyncCounts; first: boolean }): React.ReactElement {
  const rows: [string, number, string][] = [
    ['arrow-right', counts.toRecto, 'into Recto'],
    ['arrow-right', counts.toObsidian, 'into Obsidian'],
    ['alert-triangle', counts.conflicts, 'in both, different - both versions kept'],
  ]
  if (!first) {
    rows.push(['trash', counts.deleteInRecto, 'deleted in Recto (to the archive)'])
    rows.push(['trash', counts.deleteInObsidian, 'deleted in Obsidian (to its trash)'])
  }
  return (
    <ul className="osync__counts">
      {rows.map(([icon, count, label]) => (
        <li key={label} className={count === 0 ? 'is-zero' : ''}>
          <Icon name={icon} size={13} />
          <strong>{count}</strong> {plural(count, 'file', 'files').replace(/^\d+ /, '')} {label}
        </li>
      ))}
    </ul>
  )
}

export function ObsidianSync(): React.ReactElement {
  const [status, setStatus] = useState<ObsidianSyncStatus | null>(null)
  const [vaults, setVaults] = useState<ObsidianVaultInfo[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ counts: SyncCounts } | { problem: SyncProblem } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke('obsidian:status').then(setStatus)
    void api.invoke('obsidian:vaults').then(setVaults)
    return api.on('obsidian:status', setStatus)
  }, [])

  // Re-offer the folder this vault was paired with before.
  useEffect(() => {
    if (chosen === null && status?.obsidianPath != null) setChosen(status.obsidianPath)
  }, [status, chosen])

  const choose = (path: string): void => {
    setChosen(path)
    setPreview(null)
  }

  const runPreview = async (): Promise<void> => {
    if (chosen === null) return
    setBusy(true)
    const result = await api.invoke('obsidian:preview', chosen)
    setPreview(result.ok ? { counts: result.counts } : { problem: result.problem })
    setBusy(false)
  }

  if (status === null) return <p className="setting__hint">Loading…</p>

  // --- syncing -----------------------------------------------------------------
  if (status.enabled && status.obsidianPath !== null) {
    return (
      <div className="osync">
        <div className="osync__pair">
          <Icon name="refresh-cw" size={15} />
          <div>
            <p className="osync__title">Syncing with Obsidian</p>
            <p className="osync__path">{status.obsidianPath}</p>
          </div>
        </div>

        <p className="osync__state">
          {status.running
            ? 'Syncing now…'
            : status.lastSyncAt !== null
              ? `Last synced ${edited(status.lastSyncAt)}. Changes in either app are picked up within a few seconds.`
              : 'Waiting for the first pass…'}
        </p>

        {status.problem !== null && (
          <div className="osync__problem" role="alert">
            <Icon name="alert-triangle" size={14} />
            <p>{describeProblem(status.problem)}</p>
            {status.problem.reason === 'guard' && (
              <button className="btn btn--ghost btn--sm" disabled={status.running} onClick={() => void api.invoke('obsidian:sync-now', true)}>
                Sync anyway
              </button>
            )}
          </div>
        )}

        {status.last !== null && (
          <>
            <p className="osync__label">Last change</p>
            <Counts counts={status.last.counts} first={false} />
            {status.last.conflicts.length > 0 && (
              <div className="osync__conflicts">
                <p className="osync__label">Kept both versions of</p>
                <ul>
                  {status.last.conflicts.map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {status.last.errors.length > 0 && (
              <div className="osync__problem">
                <Icon name="alert-triangle" size={14} />
                <p>{plural(status.last.errors.length, 'file', 'files')} could not be synced and will be retried: {status.last.errors.slice(0, 3).join('; ')}</p>
              </div>
            )}
          </>
        )}

        <div className="setting__buttons osync__actions">
          <button className="btn btn--ghost btn--sm" disabled={status.running} onClick={() => void api.invoke('obsidian:sync-now')}>
            Sync now
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke('obsidian:disable').then(setStatus)}>
            Stop syncing
          </button>
        </div>
      </div>
    )
  }

  // --- setting up ----------------------------------------------------------------
  return (
    <div className="osync">
      <p className="setting__note">
        <Icon name="refresh-cw" size={13} />
        Two-way sync. Notes, folders and attachments go both ways, and a change in either app shows up in the other within a
        few seconds. Each app keeps its own settings - <code>.obsidian</code> and <code>.recto</code> are never copied.
        Deleted files go to Recto’s archive or Obsidian’s trash, and a note changed in both places keeps both versions.
      </p>

      <p className="osync__label">Obsidian vault</p>
      <div className="osync__vaults" role="radiogroup" aria-label="Obsidian vault">
        {vaults === null && <p className="setting__hint">Looking for Obsidian vaults…</p>}
        {vaults !== null && vaults.length === 0 && (
          <p className="setting__hint">No Obsidian vaults found on this Mac. Choose the folder instead.</p>
        )}
        {vaults?.map((vault) => (
          <button
            key={vault.path}
            role="radio"
            aria-checked={chosen === vault.path}
            className={`osync__vault${chosen === vault.path ? ' is-chosen' : ''}`}
            onClick={() => choose(vault.path)}
          >
            <span className="osync__vault-name">{vault.name}</span>
            <span className="osync__vault-meta">
              {plural(vault.notes, 'note', 'notes')}
              {vault.open ? ' · open in Obsidian' : ''}
            </span>
            <span className="osync__vault-path">{vault.path}</span>
          </button>
        ))}
        {chosen !== null && !(vaults ?? []).some((vault) => vault.path === chosen) && (
          <div className="osync__vault is-chosen">
            <span className="osync__vault-name">{chosen.split('/').pop()}</span>
            <span className="osync__vault-path">{chosen}</span>
          </div>
        )}
        <button
          className="btn btn--ghost btn--sm"
          onClick={() =>
            void api.invoke('obsidian:pick').then((path) => {
              if (path !== null) choose(path)
            })
          }
        >
          Choose a folder…
        </button>
      </div>

      {chosen !== null && preview === null && (
        <div className="setting__buttons osync__actions">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void runPreview()}>
            {busy ? 'Comparing…' : 'Preview sync'}
          </button>
        </div>
      )}

      {preview !== null && 'problem' in preview && (
        <div className="osync__problem" role="alert">
          <Icon name="alert-triangle" size={14} />
          <p>{describeProblem(preview.problem)}</p>
        </div>
      )}

      {preview !== null && 'counts' in preview && chosen !== null && (
        <div className="osync__preview">
          <p className="osync__label">The first sync will copy</p>
          <Counts counts={preview.counts} first />
          <p className="setting__hint">Nothing is deleted on the first sync. After that, both vaults stay the same.</p>
          <div className="setting__buttons osync__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => setPreview(null)}>
              Back
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => void api.invoke('obsidian:enable', chosen).then(setStatus)}>
              Start syncing
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
