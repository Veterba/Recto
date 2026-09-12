import { useCallback, useEffect, useState } from 'react'
import type { StartupState } from '@shared/ipc-contract'
import { api } from './api'
import { FirstRun } from './views/FirstRun'
import { VaultShell } from './views/VaultShell'

export function App(): React.ReactElement {
  const [state, setState] = useState<StartupState | null>(null)

  useEffect(() => {
    void api.invoke('app:startup-state').then(setState)
  }, [])

  const closeVault = useCallback(() => {
    void api.invoke('vault:close').then(setState)
  }, [])

  if (!state) return <div className="boot" />

  return state.kind === 'ready' ? (
    <VaultShell vault={state.vault} onCloseVault={closeVault} />
  ) : (
    <FirstRun state={state} onOpened={setState} />
  )
}
