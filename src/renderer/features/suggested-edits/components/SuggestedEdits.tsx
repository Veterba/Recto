import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Proposal } from '@shared/ai-access'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { useProposals } from '../use-proposals'
import { SuggestionCard } from './SuggestionCard'

/**
 * Suggested edits: what AI clients proposed, waiting for Apply or Discard.
 *
 * A count in the status bar while any wait - the small inbox, there whenever
 * Recto is, for what Claude Code, Codex or Cursor suggest from outside; main
 * also sends a notification when one arrives while Recto is not in front,
 * and clicking it opens this panel. Recto's own chats show their suggestions
 * under the answer that made them as well (SuggestionCard).
 *
 * The panel is glass over the app, as Settings is - no backdrop. A suggestion
 * settled here stays in the list with what became of it until the panel is
 * closed, so "out of date" is read rather than a card just vanishing.
 */

/** Open the review dialog from anywhere in the app: Quick ask's "Review" after an edit was suggested. */
const openers = new Set<() => void>()
export function openSuggestedEdits(): void {
  for (const open of openers) open()
}

/** Where the panel sits: centred, a little below the tabs as Settings opens, as wide as it reads well. */
function placeOf(): { left: number; top: number; width: number; maxHeight: number } {
  const width = Math.min(720, window.innerWidth - 80)
  const top = Math.max(96, Math.round(window.innerHeight * 0.12))
  return { left: Math.round((window.innerWidth - width) / 2), top, width, maxHeight: window.innerHeight - top - 48 }
}

export function SuggestedEditsNotice(): React.ReactElement | null {
  const proposals = useProposals()
  const [open, setOpen] = useState(false)
  /** Settled while the panel was open: kept in it, with their outcome, until it closes. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const pending = [...proposals.values()].filter((p) => p.status === 'pending').sort((a, b) => b.created - a.created)

  useEffect(() => {
    // Opened from a notification or a chat: with the list as it is now.
    const show = (): void => setOpen(true)
    const offOpen = api.on(IPC_EVENT.aiProposalsOpen, show)
    openers.add(show)
    return () => {
      offOpen()
      openers.delete(show)
    }
  }, [])

  // Everything pending while it is open is what it shows, settled or not, until it closes.
  const waitingIds = pending.map((p) => p.id).join('\n')
  useEffect(() => {
    if (!open) setSeen(new Set())
    else if (waitingIds !== '') setSeen((before) => new Set([...before, ...waitingIds.split('\n')]))
  }, [open, waitingIds])

  const close = useCallback(() => setOpen(false), [])
  if (pending.length === 0 && !open) return null
  // What waits now, and what was settled while it has been open - from the first frame, never an empty flash.
  const shown = [...new Set([...pending.map((p) => p.id), ...seen])]
    .map((id) => proposals.get(id))
    .filter((p): p is Proposal => p !== undefined)
    .sort((a, b) => b.created - a.created)
  return (
    <>
      {pending.length > 0 && (
        <Tip label="Suggested edits" hint="Changes AI suggested, waiting for you" placement="top">
          <button className="status__btn edits__badge" onClick={() => setOpen(true)} aria-label={`Suggested edits: ${pending.length}`}>
            <Icon name="sparkles" size={13} />
            {pending.length}
          </button>
        </Tip>
      )}
      {open && createPortal(<Panel shown={shown} waiting={pending} onClose={close} />, document.body)}
    </>
  )
}

function Panel({ shown, waiting, onClose }: { shown: Proposal[]; waiting: Proposal[]; onClose: () => void }): React.ReactElement {
  const panel = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState(placeOf)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const resize = (): void => setPlace(placeOf())
    // Esc closes it when focus is in it or nowhere: a button it removed (Apply all, once nothing is left)
    // takes the focus with it. Esc in the editor or a field stays theirs.
    const escape = (e: KeyboardEvent): void => {
      const at = document.activeElement
      if (e.key === 'Escape' && (at === null || at === document.body || panel.current?.contains(at) === true)) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', escape, true)
    }
  }, [onClose])
  // The blur's opaque base follows the panel's height (settings.css .settings-panel__base).
  useLayoutEffect(() => {
    const element = panel.current
    if (element === null) return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const every = (channel: typeof IPC.aiProposalApply | typeof IPC.aiProposalDiscard): void => {
    for (const p of waiting) if (p.canvas === undefined) void api.invoke(channel, p.id).catch(() => undefined)
  }
  return (
    <>
      <div className="settings-panel__base" style={{ left: place.left, top: place.top, width: place.width, height }} />
      <div
        ref={panel}
        className="settings-panel glass-surface edits-panel"
        role="dialog"
        aria-label="Suggested edits"
        style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}
      >
        <header className="settings-panel__head edits-panel__head">
          <h2 className="settings-panel__title">
            Suggested edits{waiting.length > 0 && <span className="edits-panel__count">{waiting.length}</span>}
          </h2>
          {waiting.filter((p) => p.canvas === undefined).length > 1 && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => every(IPC.aiProposalDiscard)}>
                Discard all
              </button>
              <button className="btn btn--sm" onClick={() => every(IPC.aiProposalApply)}>
                Apply all
              </button>
            </>
          )}
          <button className="dialog__close" onClick={onClose} aria-label="Close" autoFocus>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="edits-panel__body">
          {shown.length === 0 ? (
            <p className="edits-panel__empty">Nothing waits for you.</p>
          ) : (
            <div className="settings__card edits-panel__list">
              {shown.map((p) => (
                <SuggestionCard key={p.id} proposal={p} onOpen={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
