import { useState } from 'react'
import type { Proposal } from '@shared/ai-access'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { openFileFromAnywhere } from '../../../app/open-file'
import { Icon } from '../../../ui/Icon'
import { headingOf, itemsOf, outcomeOf, previewFile, titleOf, type ChangeItem, type DiffRow } from '../suggestion-model'
import { SuggestionPreview } from './SuggestionPreview'

/**
 * One suggestion, the same wherever it is read - under the chat's answer
 * that made it, in Quick ask, in the Suggested edits panel: a title (what it
 * does, to which note or canvas), who suggested it and when; then each
 * change - the lines in the note's own font, added green, removed red and
 * struck through, or a canvas edit in words - with ✓ and ✕; Accept all and
 * Reject all; and after, what became of each and of the whole.
 */

/** Who suggested it, as a person reads it: "Quick ask · Claude Code" from `quick-ask · Claude Code`. */
const PLACES: Record<string, string> = { 'quick-ask': 'Quick ask', 'recto-chat': 'Chat' }
const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
}
export function clientLabel(client: string): string {
  const [where, provider] = client.split(' · ')
  if (provider !== undefined) return `${PLACES[where!] ?? where} · ${provider}`
  return CLIENTS[client] ?? client
}

/** "just now", "5 min ago", "2 h ago", then the day and time. */
export function whenLabel(created: number, now = Date.now()): string {
  const minutes = Math.round((now - created) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 12 * 60) return `${Math.round(minutes / 60)} h ago`
  const at = new Date(created)
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

/** How many changes a card in a chat shows before "Show all". */
const CHAT_ITEMS = 3

const STATE: Record<Exclude<ChangeItem['state'], 'pending'>, { text: string; icon: string }> = {
  accepted: { text: 'Applied', icon: 'check' },
  rejected: { text: 'Rejected', icon: 'x' },
  stale: { text: 'Out of date', icon: 'alert-triangle' },
}

function Rows({ rows, label }: { rows: readonly DiffRow[]; label: string }): React.ReactElement {
  return (
    <div className="suggestion__diff" aria-label={label}>
      {rows.map((r, i) =>
        r.kind === 'fold' ? (
          <div key={i} className="suggestion__fold">
            {r.text}
          </div>
        ) : (
          <div key={i} className={`suggestion__line suggestion__line--${r.kind}`}>
            {r.text === '' ? ' ' : r.text}
          </div>
        ),
      )}
    </div>
  )
}

export function SuggestionCard({
  proposal,
  inChat = false,
  onOpen,
}: {
  proposal: Proposal
  inChat?: boolean
  onOpen?: () => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(!inChat)
  const [previewing, setPreviewing] = useState(false)
  const heading = headingOf(proposal)
  const items = itemsOf(proposal)
  const pending = items.filter((i) => i.state === 'pending')
  // Each change on its own only when there is more than one to choose from, and the proposal may be split.
  const each = items.length > 1 && items.every((i) => i.index !== null)
  const outcome = outcomeOf(items, proposal.canvas === undefined ? 'note' : 'canvas', proposal.file?.undone === true)
  // An applied rename, move or archive can be taken back from the card.
  const undoable = proposal.file !== undefined && proposal.status === 'applied' && proposal.file.undone !== true
  const open = (path: string): void => {
    openFileFromAnywhere(path)
    onOpen?.()
  }
  const undo = (): void => {
    setBusy(true)
    setError(null)
    void api
      .invoke(IPC.aiProposalUndo, proposal.id)
      .then((result) => {
        if (!result.ok) setError(result.error ?? 'It could not be undone.')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'It could not be undone.'))
      .finally(() => setBusy(false))
  }
  const settle = (channel: typeof IPC.aiProposalApply | typeof IPC.aiProposalDiscard, picks?: number[]): void => {
    setBusy(true)
    setError(null)
    void api
      .invoke(channel, proposal.id, picks)
      .then((result) => {
        if (!result.ok) setError('error' in result && typeof result.error === 'string' ? result.error : 'It could not be done.')
      })
      // A file that cannot be read any more: said, and the buttons work again.
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'It could not be applied.'))
      .finally(() => setBusy(false))
  }
  const shown = all ? items : items.slice(0, CHAT_ITEMS)

  return (
    <article
      className={`suggestion${inChat ? ' suggestion--chat' : ''}${outcome === null ? '' : ` is-settled is-${outcome.tone}`}`}
      aria-label={proposal.summary}
    >
      <header className="suggestion__head">
        <Icon name={heading.icon} size={14} />
        <h3 className="suggestion__title">
          <span className="suggestion__kind">{heading.verb}</span>{' '}
          {heading.target !== '' ? (
            <button className="suggestion__note" onClick={() => open(heading.target)} title={heading.target}>
              {heading.name}
            </button>
          ) : (
            heading.name !== '' && <span className="suggestion__note is-gone">{heading.name}</span>
          )}
        </h3>
        <span className="suggestion__meta">
          {clientLabel(proposal.client)} · {whenLabel(proposal.created)}
          {proposal.formatted.length > 0 && ' · formatted to your profile'}
        </span>
      </header>

      <ol className="suggestion__changes">
        {shown.map((item, k) => (
          <li key={item.index ?? item.file ?? k} className={`suggestion__change is-${item.state}`}>
            {(each || item.file !== undefined || item.label !== undefined) && (
              <div className="suggestion__change-head">
                {item.label !== undefined ? (
                  <span className="suggestion__label">
                    <Icon name={item.icon ?? 'shapes'} size={12} /> {item.label}
                  </span>
                ) : item.file !== undefined ? (
                  <button className="suggestion__filename" onClick={() => open(item.file!)}>
                    {titleOf(item.file)}
                  </button>
                ) : (
                  <span className="suggestion__label">Change {k + 1}</span>
                )}
                <span className="suggestion__spacer" />
                {item.state === 'pending' ? (
                  each && (
                    <span className="suggestion__picks">
                      <button
                        className="suggestion__pick is-yes"
                        aria-label={`Accept change ${k + 1}`}
                        title="Accept"
                        disabled={busy}
                        onClick={() => settle(IPC.aiProposalApply, [item.index!])}
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        className="suggestion__pick"
                        aria-label={`Reject change ${k + 1}`}
                        title="Reject"
                        disabled={busy}
                        onClick={() => settle(IPC.aiProposalDiscard, [item.index!])}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </span>
                  )
                ) : (
                  <span className={`suggestion__state is-${item.state}`}>
                    <Icon name={STATE[item.state].icon} size={12} /> {STATE[item.state].text}
                  </span>
                )}
              </div>
            )}
            {item.rows.length > 0 && (item.state === 'pending' || !inChat) && <Rows rows={item.rows} label={`Change ${k + 1}`} />}
          </li>
        ))}
      </ol>

      {error !== null && <p className="suggestion__error">{error}</p>}
      <footer className="suggestion__foot">
        {shown.length < items.length && (
          <button className="suggestion__more" onClick={() => setAll(true)}>
            Show all {items.length}
          </button>
        )}
        {outcome !== null ? (
          <>
            <span className={`suggestion__settled suggestion__settled--${outcome.tone}`}>
              <Icon name={outcome.tone === 'stale' ? 'alert-triangle' : outcome.tone === 'rejected' ? 'x' : 'check'} size={13} />{' '}
              {outcome.text}
            </span>
            {undoable && (
              <>
                <span className="suggestion__spacer" />
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={undo}>
                  <Icon name="rotate-ccw" size={13} /> Undo
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Seen whole before it is taken: a note as it will read, or the canvas with its ghosts. */}
            {previewFile(proposal) !== null ? (
              <button className="btn btn--ghost btn--sm" onClick={() => setPreviewing(true)}>
                <Icon name="eye" size={13} /> Preview
              </button>
            ) : (
              proposal.canvas !== undefined && (
                <button className="btn btn--ghost btn--sm" onClick={() => open(proposal.canvas!.path)}>
                  <Icon name="eye" size={13} /> Preview on the canvas
                </button>
              )
            )}
            <span className="suggestion__spacer" />
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => settle(IPC.aiProposalDiscard)}>
              {pending.length > 1 ? 'Reject all' : 'Reject'}
            </button>
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => settle(IPC.aiProposalApply)}>
              {pending.length > 1 ? 'Accept all' : 'Accept'}
            </button>
          </>
        )}
      </footer>
      {previewing && (
        <SuggestionPreview
          proposal={proposal}
          onAccept={() => settle(IPC.aiProposalApply)}
          onReject={() => settle(IPC.aiProposalDiscard)}
          onClose={() => setPreviewing(false)}
        />
      )}
    </article>
  )
}
