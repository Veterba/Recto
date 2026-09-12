import { useState } from 'react'
import type { StartupState } from '@shared/ipc-contract'
import { api } from '../api'

const EXPLAIN: Record<Exclude<StartupState, { kind: 'ready' }>['reason'], string | null> = {
  'first-run': null,
  missing: 'That folder is gone — moved, renamed, or on a drive that is not mounted.',
  unreadable: 'That folder exists but cannot be read and written.',
}

type Props = {
  state: Extract<StartupState, { kind: 'needs-vault' }>
  onOpened: (next: StartupState) => void
}

export function FirstRun({ state, onOpened }: Props): React.ReactElement {
  const [error, setError] = useState<string | null>(EXPLAIN[state.reason])
  const [busy, setBusy] = useState(false)

  async function pick(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await api.invoke('vault:pick')
    setBusy(false)
    if (res.ok) {
      onOpened({ kind: 'ready', vault: res.vault })
    } else if (!('cancelled' in res)) {
      setError(res.error)
    }
  }

  return (
    <main className="firstrun">
      <div className="firstrun__card">
        <div className="firstrun__mark" aria-hidden="true" />
        <h1>Choose a vault</h1>
        <p className="firstrun__lede">
          A vault is just a folder on your disk. Your notes stay plain markdown files inside it —
          readable by anything, yours to move, back up or delete. Pick an empty folder to start
          fresh, or point at markdown you already have.
        </p>

        {state.lastPath !== undefined && (
          <p className="firstrun__last">
            Last opened <code>{state.lastPath}</code>
          </p>
        )}

        {error !== null && (
          <p className="firstrun__error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn--primary" onClick={() => void pick()} disabled={busy} autoFocus>
          {busy ? 'Opening…' : 'Choose folder…'}
        </button>

        <p className="firstrun__fine">
          Nothing is uploaded. No account, no sign-in, no server.
        </p>
      </div>
    </main>
  )
}
