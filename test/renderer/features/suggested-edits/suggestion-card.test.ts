import { describe, expect, it } from 'vitest'
import { clientLabel, whenLabel } from '../../../../src/renderer/features/suggested-edits/components/SuggestionCard'

/** How a suggestion says who made it and when: in words, not ids and timestamps. */

describe('a suggestion, in words', () => {
  it('who made it: the place in Recto and the provider, or the outside client by name', () => {
    expect(clientLabel('quick-ask · Claude Code')).toBe('Quick ask · Claude Code')
    expect(clientLabel('recto-chat · Codex')).toBe('Chat · Codex')
    expect(clientLabel('claude-code')).toBe('Claude Code')
    expect(clientLabel('some-new-client')).toBe('some-new-client')
  })

  it('when: just now, minutes and hours ago, then the day and time', () => {
    const now = new Date('2026-11-10T12:00:00').getTime()
    expect(whenLabel(now - 20_000, now)).toBe('just now')
    expect(whenLabel(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(whenLabel(now - 3 * 3600_000, now)).toBe('3 h ago')
    expect(whenLabel(new Date('2026-11-08T09:46:00').getTime(), now)).toMatch(/8.*Nov.*09:46|Nov.*8.*09:46/)
  })
})
