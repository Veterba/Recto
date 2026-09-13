import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { TidyPlan } from '../core/tidy'

/**
 * The Tidy preview.
 *
 * Tidy moves files and rewrites every `[[link]]` that points at them, so it
 * asks first and shows exactly what it will do - grouped by destination, one
 * plain-language reason per note. "It reorganised my vault and I am not sure
 * what it did" is the single outcome that would make the feature not worth
 * having, and a preview is the whole defence against it.
 *
 * It also lists what it is NOT touching. A tidy-up that silently leaves half
 * the notes behind looks broken; one that says "these five had nothing to go
 * on" is just honest.
 */

type Props = {
  plan: TidyPlan
  /** True while the moves are being applied. */
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function TidyDialog({ plan, busy, onConfirm, onCancel }: Props): React.ReactElement {
  const [showSkipped, setShowSkipped] = useState(false)

  const groups = useMemo(() => {
    const byFolder = new Map<string, { creates: boolean; notes: TidyPlan['moves'] }>()
    for (const move of plan.moves) {
      const existing = byFolder.get(move.into)
      if (existing) existing.notes.push(move)
      else byFolder.set(move.into, { creates: move.creates, notes: [move] })
    }
    return [...byFolder.entries()]
  }, [plan])

  const newFolders = groups.filter(([, g]) => g.creates).length
  const nothingToDo = plan.moves.length === 0

  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Tidy"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape' && !busy) onCancel()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">Tidy</h2>
          <button className="dialog__close" onClick={onCancel} aria-label="Cancel" disabled={busy}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="dialog__lede">
          {nothingToDo
            ? 'Nothing to tidy — every loose note either has no signal to go on, or is already where it belongs.'
            : `Move ${plan.moves.length} loose ${plan.moves.length === 1 ? 'note' : 'notes'} into ` +
              `${groups.length} ${groups.length === 1 ? 'folder' : 'folders'}` +
              `${newFolders > 0 ? `, ${newFolders} of them new` : ''}. Links are rewritten to follow.`}
        </p>

        <div className="tidy__plan">
          {groups.map(([folder, group]) => (
            <section className="tidy__group" key={folder}>
              <h3 className="tidy__folder">
                <Icon name="folder" size={14} />
                {folder}
                {group.creates && <span className="tidy__new">new</span>}
              </h3>
              <ul className="tidy__notes">
                {group.notes.map((move) => (
                  <li className="tidy__note" key={move.path}>
                    <span className="tidy__name">{move.path.replace(/\.md$/i, '')}</span>
                    <span className="tidy__reason">{move.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {plan.skipped.length > 0 && (
          <>
            <button className="tidy__toggle" onClick={() => setShowSkipped(!showSkipped)}>
              <span className={`backlinks__chevron${showSkipped ? ' is-open' : ''}`}>{'›'}</span>
              {plan.skipped.length === 1
                ? 'Leaving 1 note where it is'
                : `Leaving ${plan.skipped.length} notes where they are`}
            </button>
            {showSkipped && (
              <ul className="tidy__notes tidy__notes--skipped">
                {plan.skipped.map((entry) => (
                  <li className="tidy__note" key={entry.path}>
                    <span className="tidy__name">{entry.path.replace(/\.md$/i, '')}</span>
                    <span className="tidy__reason">{entry.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <footer className="dialog__actions">
          <button className="dialog__ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="dialog__submit" onClick={onConfirm} disabled={busy || nothingToDo}>
            {busy ? 'Moving…' : `Move ${plan.moves.length}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
