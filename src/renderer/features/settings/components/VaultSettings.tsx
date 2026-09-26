import type { SettingsDeps } from '../settings-deps'
import { useState, useEffect } from 'react'
import type { IndexStats } from '@shared/index-results'
import type { ArchiveState } from '@shared/archive'
import { type RecentVault, ATTACHMENTS_FOLDER } from '@shared/vault'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { SettingRow } from '../../../ui/SettingRow'
import { Icon } from '../../../ui/Icon'

export function VaultSettings({ vault, onCloseVault, onSwitchVault, attachments }: SettingsDeps): React.ReactElement {
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [archive, setArchive] = useState<ArchiveState | null>(null)
  const [recent, setRecent] = useState<readonly RecentVault[]>([])
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke(IPC.indexStats).then(setStats)
    void api.invoke(IPC.archiveList).then(setArchive)
    void api.invoke(IPC.vaultRecent).then(setRecent)
  }, [])

  const switchTo = (target: string | null): void => {
    setSwitchError(null)
    setSwitching(true)
    void onSwitchVault(target).then((error) => {
      // On success this component is already gone with the old vault's shell.
      setSwitching(false)
      setSwitchError(error)
    })
  }

  return (
    <>
      <SettingRow label="Vault" hint={vault.path}>
        <div className="setting__buttons">
          <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke(IPC.fsReveal, '')}>
            Show in Finder
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onCloseVault}>
            Close vault
          </button>
        </div>
      </SettingRow>

      <SettingRow label="Change vault" hint="Open another folder of notes. Unsaved edits are saved to this vault first.">
        <button className="btn btn--sm" disabled={switching} onClick={() => switchTo(null)}>
          {switching ? 'Opening…' : 'Open another folder…'}
        </button>
      </SettingRow>
      {recent.length > 0 && (
        <div className="vault-recent" role="list" aria-label="Recent vaults">
          {recent.map((item) =>
            item.available ? (
              <button
                key={item.path}
                role="listitem"
                className="vault-recent__item"
                disabled={switching}
                onClick={() => switchTo(item.path)}
                title={`Switch to ${item.path}`}
              >
                <Icon name="folder" size={15} />
                <span className="vault-recent__name">{item.name}</span>
                <span className="vault-recent__path">{item.path}</span>
                <Icon name="arrow-right" size={13} className="vault-recent__go" />
              </button>
            ) : (
              // Gone from disk: nothing to open, only to take off the list.
              <div key={item.path} role="listitem" className="vault-recent__item is-missing" title={`${item.path} — not found`}>
                <Icon name="folder" size={15} />
                <span className="vault-recent__name">{item.name}</span>
                <span className="vault-recent__path">Not found</span>
                <button
                  className="vault-recent__forget"
                  aria-label={`Remove ${item.name} from recent vaults`}
                  title="Remove from the list"
                  onClick={() => void api.invoke(IPC.vaultForgetRecent, item.path).then(setRecent)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ),
          )}
        </div>
      )}
      {switchError !== null && (
        <p className="setting__note setting__note--error" role="alert">
          <Icon name="alert-triangle" size={13} />
          {switchError}
        </p>
      )}

      <SettingRow
        label="Attachments"
        hint={
          attachments.length === 0
            ? `Images you paste or drop into notes are kept in ${ATTACHMENTS_FOLDER}/. Nothing there yet.`
            : `${attachments.length} ${attachments.length === 1 ? 'file' : 'files'} in ${ATTACHMENTS_FOLDER}/ — images you pasted or dropped into notes. Kept out of the sidebar.`
        }
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={attachments.length === 0}
          onClick={() => void api.invoke(IPC.fsReveal, ATTACHMENTS_FOLDER)}
        >
          Show in Finder
        </button>
      </SettingRow>

      <SettingRow label="Keep deleted notes for" hint="Then they go to the system trash, still recoverable in Finder.">
        <div className="setting__buttons">
          {[7, 10, 30, 90, 0].map((days) => (
            <button
              key={days}
              className={`chip${archive?.retentionDays === days ? ' is-active' : ''}`}
              onClick={() => void api.invoke(IPC.archiveSetRetention, days).then(setArchive)}
            >
              {days === 0 ? 'Forever' : `${days} days`}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Search index"
        hint={
          stats === null ? 'Reading…' : `${stats.notes} notes · ${stats.links} links · ${stats.unresolved} unresolved · ${stats.tags} tags`
        }
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.invoke(IPC.indexReindex).then(async () => {
              setStats(await api.invoke(IPC.indexStats))
              setBusy(false)
            })
          }}
        >
          {busy ? 'Rebuilding…' : 'Rebuild index'}
        </button>
      </SettingRow>

      <p className="setting__note">
        <Icon name="history" size={13} />
        The index and version history live in <code>.recto/index.db</code>. Deleting it rebuilds the index from your notes — but loses
        version history, which cannot be rebuilt because it is what your files <em>used</em> to be.
      </p>
    </>
  )
}
