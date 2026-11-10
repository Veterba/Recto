import { useState } from 'react'
import type { FileChange, Proposal } from '@shared/ai-access'
import { IPC } from '@shared/ipc'
import { diffLines } from '@shared/line-diff'
import { api } from '../../../app/api'
import { openFileFromAnywhere } from '../../../app/open-file'
import { Icon } from '../../../ui/Icon'

/**
 * One suggestion, as it reads in a chat under the answer that made it and in
 * the Suggested edits panel: which note, what kind of change, who suggested
 * it and when; the change itself in the note's own font, added lines marked
 * green, removed ones red and struck through; Apply and Discard - or, once
 * settled, what became of it.
 */

/** Who suggested it, as a person reads it: "Quick ask · Claude Code" from `quick-ask · Claude Code`. */
const PLACES: Record<string, string> = { 'quick-ask': 'Quick ask', 'recto-chat': 'Chat' }
const CLIENTS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor' }
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

/** What kind of change, by the tool that made it; the summary when there is no better word. */
const KINDS: Record<string, { verb: string; icon: string }> = {
  propose_append: { verb: 'Adds to', icon: 'pen-line' },
  propose_edit: { verb: 'Changes', icon: 'pen-line' },
  propose_new_note: { verb: 'New note', icon: 'file-plus' },
  propose_link: { verb: 'Adds a link to', icon: 'link' },
  propose_task: { verb: 'New card on', icon: 'square-kanban' },
  propose_task_update: { verb: 'Changes card', icon: 'square-kanban' },
}

const titleOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')

/** The changed lines with two lines around them; longer unchanged runs fold into one line that says how many. */
function diffRows(change: FileChange): React.ReactNode[] {
  const lines = diffLines(change.before === null ? [] : change.before.split('\n'), change.after.split('\n'))
  const near = new Set<number>()
  lines.forEach((l, i) => {
    if (l.kind !== 'same') for (let k = i - 2; k <= i + 2; k++) near.add(k)
  })
  const rows: React.ReactNode[] = []
  let folded = 0
  const fold = (at: number): void => {
    if (folded > 0) rows.push(<div key={`f${at}`} className="suggestion__fold">{folded === 1 ? '1 line unchanged' : `${folded} lines unchanged`}</div>)
    folded = 0
  }
  lines.forEach((l, i) => {
    if (!near.has(i)) {
      folded++
      return
    }
    fold(i)
    rows.push(
      <div key={i} className={`suggestion__line suggestion__line--${l.kind}`}>
        {l.text === '' ? ' ' : l.text}
      </div>,
    )
  })
  fold(lines.length)
  return rows
}

function Diff({ change, limit }: { change: FileChange; limit: number | null }): React.ReactElement {
  const rows = diffRows(change)
  const shown = limit === null ? rows : rows.slice(0, limit)
  return (
    <div className="suggestion__diff" aria-label={`Changes to ${titleOf(change.path)}`}>
      {shown}
      {shown.length < rows.length && <div className="suggestion__fold">…</div>}
    </div>
  )
}

const SETTLED: Record<Exclude<Proposal['status'], 'pending'>, { text: string; icon: string }> = {
  applied: { text: 'Applied', icon: 'check' },
  discarded: { text: 'Discarded', icon: 'x' },
  stale: { text: 'Out of date: the note changed since, so it was not applied', icon: 'alert-triangle' },
}

/** How many diff rows a card in a chat shows before "Show all". */
const CHAT_ROWS = 8

export function SuggestionCard({ proposal, inChat = false, onOpen }: { proposal: Proposal; inChat?: boolean; onOpen?: () => void }): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(!inChat)
  const kind = KINDS[proposal.tool]
  const target = proposal.canvas?.path ?? proposal.files.at(-1)?.path ?? ''
  const open = (path: string): void => {
    openFileFromAnywhere(path)
    onOpen?.()
  }
  const settle = (channel: typeof IPC.aiProposalApply | typeof IPC.aiProposalDiscard): void => {
    setBusy(true)
    setError(null)
    void api
      .invoke(channel, proposal.id)
      .then((result) => {
        if (!result.ok) setError('error' in result && typeof result.error === 'string' ? result.error : 'It could not be done.')
      })
      // A file that cannot be read any more: said, and the buttons work again.
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'It could not be applied.'))
      .finally(() => setBusy(false))
  }
  const settled = proposal.status === 'pending' ? null : SETTLED[proposal.status]

  return (
    <article className={`suggestion${inChat ? ' suggestion--chat' : ''}${settled === null ? '' : ' is-settled'}`} aria-label={proposal.summary}>
      <header className="suggestion__head">
        <Icon name={proposal.canvas !== undefined ? 'shapes' : (kind?.icon ?? 'sparkles')} size={14} />
        <span className="suggestion__kind">{proposal.canvas !== undefined ? 'Changes on' : (kind?.verb ?? proposal.summary)}</span>
        {(kind !== undefined || proposal.canvas !== undefined) && target !== '' && (
          <button className="suggestion__note" onClick={() => open(target)} title={target}>
            {titleOf(target)}
          </button>
        )}
        <span className="suggestion__meta">
          {clientLabel(proposal.client)} · {whenLabel(proposal.created)}
          {proposal.formatted.length > 0 && ' · formatted to your profile'}
        </span>
      </header>

      {settled === null &&
        (proposal.canvas !== undefined ? (
          // A canvas's changes are reviewed on the canvas, one by one, as ghosts.
          <p className="suggestion__canvas">
            {proposal.canvas.states.filter((s) => s === 'pending').length} changes to review on the canvas.{' '}
            <button className="btn btn--sm" onClick={() => open(proposal.canvas!.path)}>
              Open to review
            </button>
          </p>
        ) : (
          proposal.files.map((f) => (
            <section key={f.path} className="suggestion__file">
              {proposal.files.length > 1 && (
                <button className="suggestion__filename" onClick={() => open(f.path)}>
                  {f.before === null ? 'New: ' : ''}
                  {titleOf(f.path)}
                </button>
              )}
              <Diff change={f} limit={all ? null : CHAT_ROWS} />
            </section>
          ))
        ))}

      {error !== null && <p className="suggestion__error">{error}</p>}
      <footer className="suggestion__foot">
        {settled !== null ? (
          <span className={`suggestion__settled suggestion__settled--${proposal.status}`}>
            <Icon name={settled.icon} size={13} /> {settled.text}
          </span>
        ) : (
          <>
            {!all && proposal.files.some((f) => diffRows(f).length > CHAT_ROWS) && (
              <button className="suggestion__more" onClick={() => setAll(true)}>
                Show all
              </button>
            )}
            <span className="suggestion__spacer" />
            {proposal.canvas === undefined && (
              <>
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => settle(IPC.aiProposalDiscard)}>
                  Discard
                </button>
                <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => settle(IPC.aiProposalApply)}>
                  Apply
                </button>
              </>
            )}
          </>
        )}
      </footer>
    </article>
  )
}
