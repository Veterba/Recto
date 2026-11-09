import { describe, expect, it } from 'vitest'
import { claimsPendingEdit, recordLine, withRecords, type AnswerRecord } from '../../src/shared/answer-record'
import type { ProposalStatus } from '../../src/shared/ai-access'

/**
 * The record that goes back to the model after each earlier answer: what it
 * read in full, only skimmed, and suggested - each suggestion with its state
 * now - so a follow-up never takes back a read or an edit that happened, and
 * never suggests an applied edit again. Names and counts only, no note text.
 */

const TRIP = 'Projects/Japan trip'
const record: AnswerRecord = {
  read: [`${TRIP}/Itinerary.md`, `${TRIP}/Budget.md`, `${TRIP}/Kyoto.md`, 'Recto/Boards/Japan trip/Japan trip.md'],
  skimmed: [`${TRIP}/Tokyo.md`],
  proposals: ['p1'],
}
const states = (map: Record<string, ProposalStatus>) => (id: string) => map[id] ?? null

describe('the answer record', () => {
  it('names what was read in full and what was only skimmed, and the suggestion as it stands now', () => {
    expect(recordLine(record, states({ p1: 'pending' }))).toBe(
      "(Recto's record of your answer above - what really happened: read in full: Itinerary, Budget, Kyoto, Japan trip; only skimmed (summary or excerpt): Tokyo; suggested edits: 1 waiting for Apply.)",
    )
  })

  it('an applied suggestion is said to be in the note already; a gone one is expired', () => {
    expect(recordLine(record, states({ p1: 'applied' }))).toContain('1 applied, already in the note - do not suggest it again')
    expect(recordLine({ ...record, proposals: ['p1', 'p2', 'p3'] }, states({ p1: 'discarded', p2: 'stale' }))).toContain(
      'suggested edits: 1 discarded by the person; 1 out of date: the note changed since, so it can no longer be applied; 1 expired.',
    )
    expect(recordLine({ read: [], skimmed: [], proposals: [] }, () => null)).toContain(
      'read in full: none; only skimmed (summary or excerpt): none; suggested edits: none.',
    )
  })

  it('opens the message after each answer that has one - in Recto’s words, not the answer’s - and nowhere else', () => {
    const sent = withRecords(
      [
        { role: 'user', content: 'Analyze this note.' },
        { role: 'assistant', content: 'Three things.', record },
        { role: 'user', content: 'Add a Day-by-day section.' },
        { role: 'assistant', content: 'From before records.' },
        { role: 'user', content: 'Anything else?' },
      ],
      states({ p1: 'applied' }),
    )
    expect(sent[0]).toEqual({ role: 'user', content: 'Analyze this note.' })
    expect(sent[1]).toEqual({ role: 'assistant', content: 'Three things.' })
    expect(sent[2]!.content).toMatch(/^\(Recto's record of your answer above - [^\n]*1 applied, already in the note[^\n]*\)\n\nAdd a Day-by-day section\.$/)
    expect(sent[4]).toEqual({ role: 'user', content: 'Anything else?' })
    expect(Object.keys(sent[2]!)).toEqual(['role', 'content'])
  })
})

describe('an answer that says an edit is waiting', () => {
  it('is spotted, in English and in Russian', () => {
    expect(claimsPendingEdit('Suggestion, waiting for Apply: I proposed edits to Japan trip plan.')).toBe(true)
    expect(claimsPendingEdit('It waits for your Apply.')).toBe(true)
    expect(claimsPendingEdit("I've suggested an edit that adds the section.")).toBe(true)
    expect(claimsPendingEdit('Правка ждёт применения.')).toBe(true)
  })

  it('an answer that only analyses is not', () => {
    expect(claimsPendingEdit('The maples and your dates do not match. You could add a note about the foliage forecast.')).toBe(false)
    expect(claimsPendingEdit('Apply sunscreen in Kyoto.')).toBe(false)
  })

  it('a sentence that says none is waiting claims nothing', () => {
    expect(claimsPendingEdit('I couldn’t submit the section. Nothing is waiting for Apply.')).toBe(false)
    expect(claimsPendingEdit('I never proposed the edits I described, so none are waiting for Apply.')).toBe(false)
    expect(claimsPendingEdit('Ничего не ждёт применения.')).toBe(false)
    expect(claimsPendingEdit('Nothing else to add. Suggestion, waiting for Apply: a Day by day section.')).toBe(true)
  })
})
