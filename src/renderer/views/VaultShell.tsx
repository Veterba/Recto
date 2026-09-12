import { useCallback, useEffect, useState } from 'react'
import type { VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { CommandPalette } from '../components/CommandPalette'
import { WorkspaceView } from '../components/WorkspaceView'
import { commands } from '../core/commands'
import { registerAppCommands } from '../core/register-commands'
import { useWorkspace } from '../core/use-workspace'
import { registerStubViews } from './stubs'

type Props = {
  vault: VaultInfo
  onCloseVault: () => void
}

// Views register once for the lifetime of the module, before any layout is
// restored - otherwise a saved leaf would resolve to "unknown" on first paint.
registerStubViews()

export function VaultShell({ vault, onCloseVault }: Props): React.ReactElement {
  const { workspace, revision } = useWorkspace()
  const [paletteOpen, setPaletteOpen] = useState(false)

  const openPalette = useCallback(() => setPaletteOpen(true), [])

  // Commands are registered against the live workspace, and torn down with it.
  useEffect(() => {
    if (!workspace) return
    return registerAppCommands(commands, { workspace, openPalette, closeVault: onCloseVault })
  }, [workspace, openPalette, onCloseVault])

  // User hotkey overrides, if hotkeys.json exists.
  useEffect(() => {
    void api.invoke('state:read', 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') {
        commands.setOverrides(saved as Record<string, string | null>)
      }
    })
  }, [])

  // One keydown listener for the whole app. Everything routes through the registry.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
        return
      }
      if (commands.handleKeyEvent(ev)) ev.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  return (
    <div className="shell">
      <header className="shell__bar">
        <span className="shell__vault">{vault.name}</span>
        <div className="shell__actions">
          <button className="btn btn--ghost btn--sm" onClick={openPalette}>
            <kbd>⌘P</kbd> Commands
          </button>
        </div>
      </header>

      <div className="shell__body">
        {workspace ? (
          // `revision` is the subscription: the Workspace is mutable, so React
          // needs an explicit signal that the tree changed.
          <WorkspaceView key={revision} workspace={workspace} />
        ) : (
          <div className="pane-empty">
            <p>Restoring layout…</p>
          </div>
        )}
      </div>

      <CommandPalette registry={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
