import { useState } from 'react'
import type { BotModelStatus } from '@shared/bots'
import { Icon } from '../../../ui/Icon'
import { describeStatus } from '../hooks/use-bots'

/**
 * Whether the local model can run, and when it cannot, the one thing to do
 * about it. `compact` is the chat's one muted line above the composer: the
 * command to run, without the sentence around it.
 */
export function BotStatusLine({
  status,
  onRecheck,
  compact = false,
}: {
  status: BotModelStatus | null
  onRecheck?: () => void
  compact?: boolean
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  if (status === null) return <p className="bot-status">Checking the local model…</p>
  const { label, fix, command } = describeStatus(status)
  const ready = status.state === 'ready'
  if (compact) {
    return (
      <p className={`composer__status is-${status.state}`}>
        <span className="composer__dot" aria-hidden="true" />
        {label}
        {command !== null ? (
          <>
            {' · '}
            <button
              className="composer__command"
              title="Copy"
              onClick={() => {
                void navigator.clipboard.writeText(command).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1200)
                })
              }}
            >
              {copied ? 'Copied' : command}
            </button>
          </>
        ) : (
          fix !== null && <> · {fix}</>
        )}
        {onRecheck !== undefined && status.state !== 'loading' && (
          <button className="composer__link" onClick={onRecheck}>
            Check again
          </button>
        )}
      </p>
    )
  }
  return (
    <div className={`bot-status${ready ? ' is-ready' : ' is-down'}`}>
      <p className="bot-status__label">
        <span className="bot-status__dot" aria-hidden="true" />
        {label}
        {onRecheck !== undefined && !ready && (
          <button className="bot-status__again" onClick={onRecheck}>
            Check again
          </button>
        )}
      </p>
      {fix !== null && <p className="bot-status__fix">{fix}</p>}
      {command !== null && (
        <div className="bot-status__command">
          <code>{command}</code>
          <button
            className={`bot-status__copy${copied ? ' is-done' : ''}`}
            onClick={() => {
              void navigator.clipboard.writeText(command).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
              })
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}
