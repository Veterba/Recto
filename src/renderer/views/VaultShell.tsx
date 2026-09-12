import type { VaultInfo } from '@shared/ipc-contract'

type Props = {
  vault: VaultInfo
  onCloseVault: () => void
}

/**
 * Placeholder for milestone 1.2-1.8. The rail, sidebar, tabs and editor land here;
 * right now it exists to prove the vault round-trip works end to end.
 */
export function VaultShell({ vault, onCloseVault }: Props): React.ReactElement {
  return (
    <div className="shell">
      <header className="shell__bar">
        <span className="shell__vault">{vault.name}</span>
        <button className="btn btn--ghost" onClick={onCloseVault}>
          Close vault
        </button>
      </header>
      <div className="shell__body">
        <p className="shell__todo">
          Vault open at <code>{vault.path}</code>
          <br />
          Next: the workspace tree, command registry and file explorer.
        </p>
      </div>
    </div>
  )
}
