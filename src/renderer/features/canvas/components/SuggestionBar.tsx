import type { Proposal } from '@shared/ai-access'
import { Icon } from '../../../ui/Icon'
import { openSuggestedEdits } from '../../suggested-edits'

/**
 * An outside app's suggestions for the open canvas, said in a bar over it -
 * nothing drawn on the canvas itself: what it would look like is in the
 * suggestion's Preview. Suggestions from Recto's chats and Quick ask have no
 * bar: they show where they were asked for, once the answer is there.
 */

const CLIENTS: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor' }
const who = (client: string): string => CLIENTS[client] ?? client
const outside = (p: Proposal): boolean => !p.client.startsWith('recto') && !p.client.startsWith('quick-ask')

export function SuggestionBar({ proposals }: { proposals: readonly Proposal[] }): React.ReactElement | null {
  const shown = proposals.filter(outside)
  if (shown.length === 0) return null
  const names = [...new Set(shown.map((p) => who(p.client)))]
  const pending = shown.reduce((n, p) => n + (p.canvas?.states.filter((s) => s === 'pending').length ?? 0), 0)
  return (
    <div className="canvas-suggestions glass-surface" role="status" aria-label="Suggested changes">
      <Icon name="sparkles" size={14} />
      <span>
        {names.join(', ')} {names.length === 1 ? 'suggests' : 'suggest'} {pending} change{pending === 1 ? '' : 's'}
      </span>
      <button className="btn btn--sm" onClick={openSuggestedEdits}>
        Review
      </button>
    </div>
  )
}
