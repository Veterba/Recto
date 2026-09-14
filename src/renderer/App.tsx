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

  /**
   * Swap one vault for another without restarting.
   *
   * The shell is unmounted FIRST, and the switch waits a beat: every open note
   * flushes its unsaved text on unmount, and those writes have to reach main
   * while the old vault is still the open one - sent after the switch, the same
   * relative path would land in the new vault. Returns an error sentence, or
   * null when it worked or was cancelled.
   */
  const switchVault = useCallback(
    async (target: string | null): Promise<string | null> => {
      const current = state?.kind === 'ready' ? state.vault : null
      const dir = target ?? (await api.invoke('vault:choose-folder'))
      if (dir === null || dir === current?.path) return null
      setState(null)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const result = await api.invoke('vault:switch', dir)
      if (result.ok) {
        setState({ kind: 'ready', vault: result.vault })
        return null
      }
      // The old vault is still open in main; put it back on screen.
      if (current !== null) setState({ kind: 'ready', vault: current })
      else setState(await api.invoke('app:startup-state'))
      return 'cancelled' in result ? null : result.error
    },
    [state],
  )

  if (!state) return <div className="boot" />

  return state.kind === 'ready' ? (
    // Keyed on the path, so nothing from one vault's session survives into the next.
    <VaultShell key={state.vault.path} vault={state.vault} onCloseVault={closeVault} onSwitchVault={switchVault} />
  ) : (
    <FirstRun state={state} onOpened={setState} />
  )
}
