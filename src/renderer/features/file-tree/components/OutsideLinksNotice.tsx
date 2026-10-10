import { useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { useNoteBus } from '../../../app/note-bus'
import { Icon } from '../../../ui/Icon'

/**
 * "2 symlinks point outside the vault and are skipped: notes/linked, pw.md",
 * in the status bar, once per session, until dismissed.
 *
 * Such links are never listed, opened or indexed (a vault cloned from someone
 * else's repo could link to ~/.ssh). Skipping them silently would leave you
 * wondering where a folder went, so they are named once.
 */
export function OutsideLinksNotice(): React.ReactElement | null {
  const [paths, setPaths] = useState<string[]>([])
  // Bumped after every tree reload, which is when main has walked the vault.
  const { revision } = useNoteBus()

  useEffect(() => {
    let live = true
    void api.invoke(IPC.fsOutsideLinks).then((fresh) => {
      if (live && fresh.length > 0) setPaths((prev) => [...prev, ...fresh])
    })
    return () => {
      live = false
    }
  }, [revision])

  if (paths.length === 0) return null

  const label =
    paths.length === 1
      ? `A symlink points outside the vault and is skipped: ${paths[0]}`
      : `${paths.length} symlinks point outside the vault and are skipped: ${paths.join(', ')}`

  return (
    <span className="status__notice" role="status" title={paths.join('\n')}>
      <Icon name="alert-triangle" size={12} />
      <span className="status__notice-text">{label}</span>
      <button className="status__notice-undo" onClick={() => setPaths([])} aria-label="Dismiss">
        OK
      </button>
    </span>
  )
}
