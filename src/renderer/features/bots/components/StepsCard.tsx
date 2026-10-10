import { useState } from 'react'
import { stepsSummary } from '@shared/bot-status'
import type { BotStep } from '@shared/bots'
import { Icon } from '../../../ui/Icon'

/**
 * What the bot did before answering, as a checklist above the answer: one line
 * per step, "<action> → <result>". Open while it works; once the answer is in,
 * folded to one line ("Looked through 4 notes ▸") that opens it again - with
 * a small beat as it folds, the moment the answer's first words arrive.
 */

export function StepsCard({
  steps,
  running,
  fresh = false,
}: {
  steps: readonly BotStep[]
  running: boolean
  /** Just folded, on the answer's first words: the found beat. */
  fresh?: boolean
}): React.ReactElement | null {
  // Open while the steps run; after that, the user's choice.
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null
  if (!running && !open) {
    return (
      <button className={`bot-steps--folded${fresh ? ' is-fresh' : ''}`} onClick={() => setOpen(true)} aria-expanded="false">
        {stepsSummary(steps)}
        <Icon name="chevron-right" size={12} />
      </button>
    )
  }
  return (
    <div className="bot-steps" role="list" aria-live="polite" {...(running ? {} : { onClick: () => setOpen(false) })}>
      {steps.map((step, i) => (
        <div key={i} className={`bot-steps__row is-${step.state}`} role="listitem">
          <span className="bot-steps__mark" aria-hidden="true">
            {step.state === 'running' ? (
              <span className="bot-steps__dot" />
            ) : (
              <Icon name={step.state === 'done' ? 'check' : 'x'} size={12} strokeWidth={2.4} />
            )}
          </span>
          <span className="bot-steps__text">
            <b>{step.action}</b>
            {step.result !== '' && <> → {step.result}</>}
          </span>
        </div>
      ))}
    </div>
  )
}
