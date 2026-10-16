import { describe, expect, it } from 'vitest'
import { coerce } from '../../../src/renderer/app/appearance'

describe('the heading font', () => {
  it('is sans for a new install, the same family as the note title', () => {
    expect(coerce(null).headingFont).toBe('sans')
    expect(coerce({}).headingFont).toBe('sans')
  })

  it("a 'match' saved before it could be chosen on purpose becomes sans, once", () => {
    // The old default: 'match' over a mono body made every heading mono.
    expect(coerce({ headingFont: 'match' }).headingFont).toBe('sans')
  })

  it("a 'match' picked in Settings, and any other choice, are kept", () => {
    expect(coerce({ headingFont: 'match', headingFontChosen: true }).headingFont).toBe('match')
    expect(coerce({ headingFont: 'serif' }).headingFont).toBe('serif')
    expect(coerce({ headingFont: 'mono' }).headingFont).toBe('mono')
  })
})
