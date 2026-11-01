import { useSyncExternalStore } from 'react'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'

/**
 * Whether the Data tree shows the Recto folder (boards, cards, chats). Off by
 * default: those notes have their own screens. Kept per vault, in .recto/.
 */

const KEY = 'recto-folder'
let show = false
let loaded: string | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const listener of listeners) listener()
}

/** Read the vault's choice once per vault. */
export function loadRectoFolderSetting(vaultPath: string): void {
  if (loaded === vaultPath) return
  loaded = vaultPath
  show = false
  emit()
  void api.invoke(IPC.stateRead, KEY).then((saved) => {
    const value = (saved as { show?: unknown } | null)?.show
    show = value === true
    emit()
  })
}

export function setShowRectoFolder(on: boolean): void {
  show = on
  emit()
  void api.invoke(IPC.stateWrite, KEY, { show: on })
}

export function useShowRectoFolder(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => show,
  )
}
