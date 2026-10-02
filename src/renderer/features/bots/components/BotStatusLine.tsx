import { useState } from 'react'
import type { BotModelStatus } from '@shared/bots'
import { Icon } from '../../../ui/Icon'
import { describeStatus } from '../hooks/use-bots'

/** Whether the local model can run, and when it cannot, the one thing to do about it. */
export function BotStatusLine({ status, onRecheck }: { status: BotModelStatus | null; onRecheck?: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  if (status === null) return <p className="bot-status">Checking the local model…</p>
  const { label, fix, command } = describeStatus(status)
  const ready = status.state === 'ready'
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
            className={`chat__copy${copied ? ' is-done' : ''}`}
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
