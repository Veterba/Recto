import type { ProviderProblem } from '@shared/providers'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { openSettingsAt } from '../../../app/settings-request'

/**
 * A cloud provider that cannot answer, in the chat's one muted line above the
 * composer: what is wrong and the one thing to do about it - install the CLI,
 * sign in, manage the plan's usage, turn cloud on. The same line in the
 * Chats panel and in Quick ask.
 */

const ACTION: Partial<Record<ProviderProblem['kind'], string>> = {
  'cloud-off': 'Turn on',
  'cli-missing': 'Install',
  'signed-out': 'Settings',
  expired: 'Sign in',
  'no-key': 'Add a key',
  limit: 'Manage usage',
}

export function ProblemLine({ problem, onDismiss }: { problem: ProviderProblem; onDismiss?: () => void }): React.ReactElement {
  const label = ACTION[problem.kind]
  const act = (): void => {
    if (problem.url !== undefined) void api.invoke(IPC.providersOpenUrl, problem.url)
    else openSettingsAt('ai')
  }
  return (
    <p className={`composer__status is-error is-${problem.kind}`} role="alert">
      <span className="composer__dot" aria-hidden="true" />
      <span className="composer__problem">{problem.message}</span>
      {label !== undefined && (
        <button className="composer__link" onClick={act}>
          {problem.kind === 'limit' && problem.url === undefined ? 'Settings' : label}
        </button>
      )}
      {onDismiss !== undefined && (
        <button className="composer__link" onClick={onDismiss}>
          {problem.kind === 'down' || problem.kind === 'failed' ? 'Dismiss' : 'Check again'}
        </button>
      )}
    </p>
  )
}
