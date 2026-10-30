import { describe, expect, it } from 'vitest'
import { summary } from '../../../../src/renderer/features/editor/property-summary'

describe('collapsed properties line', () => {
  it('shows each kind of value briefly', () => {
    expect(summary(['films', 'to watch'])).toBe('films, to watch')
    expect(summary(true)).toBe('yes')
    expect(summary(null)).toBe('—')
    expect(summary(3)).toBe('3')
  })

  it('shows links by their name or label', () => {
    expect(summary('[[Movie list]]')).toBe('Movie list')
    expect(summary(['[[Recto Tasks#Doing|Doing]]', '[[Ideas]]'])).toBe('Doing, Ideas')
  })

  it('cuts long text short', () => {
    expect(summary('a'.repeat(40))).toBe(`${'a'.repeat(31)}…`)
  })
})
