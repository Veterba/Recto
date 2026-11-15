import { describe, expect, it } from 'vitest'
import type { Proposal } from '../../../../src/shared/ai-access'
import { previewFile, previewOf } from '../../../../src/renderer/features/suggested-edits/suggestion-model'

/** A suggestion's preview: the note as it would read once accepted, from the note as it is now. Invented notes. */

const NOTE = '# Basil\n\nPinch the tops.\n\n## Harvest\n\nMorning.\n'
const proposal = (files: Proposal['files'], extra: Partial<Proposal> = {}): Proposal => ({
  id: 'p',
  client: 'recto-chat · Codex',
  tool: 'propose_edit',
  summary: 's',
  created: 0,
  status: 'pending',
  formatted: [],
  files,
  ...extra,
})

describe('a suggestion’s preview', () => {
  it('the note as it will read, its added and changed lines marked, from the note as it is now', () => {
    const p = proposal([
      {
        path: 'Basil.md',
        before: NOTE,
        after: NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\nDry in the shade.\n'),
      },
    ])
    // Typed since: a line at the top. The preview has it too, and marks only the suggestion's lines.
    const now = `Seeds from Anna.\n${NOTE}`
    const preview = previewOf(p, now)!
    expect(preview.text).toBe(
      `Seeds from Anna.\n${NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\nDry in the shade.\n')}`,
    )
    expect(preview.marked.map((n) => preview.text.split('\n')[n])).toEqual(['Pinch the tops weekly.', 'Dry in the shade.'])
    expect(preview).toMatchObject({ removed: 1, stale: 0 })
  })

  it('changes already accepted are in the note, not marked again; one that no longer fits is counted', () => {
    const after = NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\nDry in the shade.\n')
    const p = proposal([{ path: 'Basil.md', before: NOTE, after, states: ['pending', 'pending'] }])
    const now = NOTE.replace('Pinch the tops.', 'Pinch them in June.')
    const preview = previewOf(p, now)!
    expect(preview.stale).toBe(1)
    expect(preview.marked.map((n) => preview.text.split('\n')[n])).toEqual(['Dry in the shade.'])
  })

  it('a new note is all marked, its empty lines left plain; a card and its board preview the card’s note; a canvas or a rename have none here', () => {
    const fresh = previewOf(
      proposal([{ path: 'Watering.md', before: null, after: '# Watering\n\nAt the root.\n' }], { tool: 'propose_new_note' }),
      null,
    )!
    // Every line with something on it.
    expect(fresh.marked.map((n) => fresh.text.split('\n')[n])).toEqual(['# Watering', 'At the root.'])
    const card = proposal([
      { path: 'Board.md', before: '## To do\n', after: '## To do\n- [ ] [[Ship it]]\n' },
      { path: 'Ship it.md', before: null, after: '# Ship it\n' },
    ])
    expect(previewFile(card)?.path).toBe('Ship it.md')
    expect(previewFile(proposal([], { file: { kind: 'rename', from: 'a.md', to: 'b.md' } }))).toBeNull()
  })
})
