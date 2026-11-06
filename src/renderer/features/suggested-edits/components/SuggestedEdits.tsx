import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Proposal } from '@shared/ai-access'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { diffLines } from '@shared/line-diff'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'

/**
 * Suggested edits: what AI clients proposed, waiting for Apply or Discard.
 *
 * A count in the status bar while any wait - the small inbox, there whenever
 * Recto is; main also sends a notification when one arrives while Recto is
 * not in front, and clicking it opens this list. Each suggestion shows its
 * diff exactly as it will be written, formatting already applied.
 */

const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
}

/** The changed lines with two lines of context, unchanged runs folded. */
function Diff({ before, after }: { before: string | null; after: string }): React.ReactElement {
  const lines = diffLines(before === null ? [] : before.split('\n'), after.split('\n'))
  const near = new Set<number>()
  lines.forEach((l, i) => {
    if (l.kind !== 'same') for (let k = i - 2; k <= i + 2; k++) near.add(k)
  })
  const out: React.ReactNode[] = []
  let folded = false
  lines.forEach((l, i) => {
    if (!near.has(i)) {
      if (!folded)
        out.push(
          <div key={`f${i}`} className="edits__fold">
            ⋯
          </div>,
        )
      folded = true
      return
    }
    folded = false
    out.push(
      <div key={i} className={`edits__line edits__line--${l.kind}`}>
        <span aria-hidden="true">{l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : ' '}</span>
        {l.text === '' ? ' ' : l.text}
      </div>,
    )
  })
  return <pre className="edits__diff">{out}</pre>
}

function ProposalCard({ proposal, onDone }: { proposal: Proposal; onDone: () => void }): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <article className="edits__item" aria-label={proposal.summary}>
      <header className="edits__itemhead">
        <strong>{proposal.summary}</strong>
        <span className="edits__meta">
          {CLIENTS[proposal.client] ?? proposal.client} · {new Date(proposal.created).toLocaleString()}
          {proposal.formatted.length > 0 && ` · formatted to your profile`}
        </span>
      </header>
      {proposal.files.map((f) => (
        <section key={f.path}>
          <div className="edits__path">
            {f.before === null ? 'New: ' : ''}
            {f.path}
          </div>
          <Diff before={f.before} after={f.after} />
        </section>
      ))}
      {error !== null && <p className="edits__error">{error}</p>}
      <div className="edits__buttons">
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.invoke(IPC.aiProposalDiscard, proposal.id).then(onDone)
          }}
        >
          Discard
        </button>
        <button
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.invoke(IPC.aiProposalApply, proposal.id).then((result) => {
              setBusy(false)
              if (result.ok) onDone()
              else setError(result.error ?? 'It could not be applied.')
            })
          }}
        >
          Apply
        </button>
      </div>
    </article>
  )
}

/** Open the review dialog from anywhere in the app: Quick ask's "Review" after an edit was suggested. */
const openers = new Set<() => void>()
export function openSuggestedEdits(): void {
  for (const open of openers) open()
}

export function SuggestedEditsNotice(): React.ReactElement | null {
  const [pending, setPending] = useState<Proposal[]>([])
  const [open, setOpen] = useState(false)
  const refresh = useCallback(
    () => void api.invoke(IPC.aiProposals).then((all) => setPending(all.filter((p) => p.status === 'pending'))),
    [],
  )

  useEffect(() => {
    refresh()
    const offChanged = api.on(IPC_EVENT.aiProposalsChanged, refresh)
    // Opened once the list is in: opened first, the empty list it had would shut it again at once.
    const show = (): void =>
      void api.invoke(IPC.aiProposals).then((all) => {
        setPending(all.filter((p) => p.status === 'pending'))
        setOpen(true)
      })
    const offOpen = api.on(IPC_EVENT.aiProposalsOpen, show)
    openers.add(show)
    return () => {
      offChanged()
      offOpen()
      openers.delete(show)
    }
  }, [refresh])

  useEffect(() => {
    if (open && pending.length === 0) setOpen(false)
  }, [open, pending.length])

  if (pending.length === 0) return null
  return (
    <>
      <Tip label="Suggested edits" hint="Changes AI clients proposed, waiting for you" placement="top">
        <button className="status__btn edits__badge" onClick={() => setOpen(true)} aria-label={`Suggested edits: ${pending.length}`}>
          <Icon name="sparkles" size={13} />
          {pending.length}
        </button>
      </Tip>
      {open &&
        createPortal(
          <div
            className="dialog__backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
          >
            <div
              className="dialog edits"
              role="dialog"
              aria-modal="true"
              aria-label="Suggested edits"
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setOpen(false)
              }}
            >
              <header className="dialog__head">
                <h2 className="dialog__title">Suggested edits</h2>
                <button className="dialog__close" onClick={() => setOpen(false)} aria-label="Close" autoFocus>
                  <Icon name="x" size={16} />
                </button>
              </header>
              <div className="edits__list">
                {pending.map((p) => (
                  <ProposalCard key={p.id} proposal={p} onDone={refresh} />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
