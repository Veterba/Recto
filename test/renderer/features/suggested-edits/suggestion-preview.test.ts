import { describe, expect, it } from 'vitest'
import type { Proposal } from '../../../../src/shared/ai-access'
import { parseCanvas } from '../../../../src/shared/canvas'
import { briefOf, previewOf, previewTarget } from '../../../../src/renderer/features/suggested-edits/suggestion-model'

/** A suggestion's preview: the file as it will be once accepted, from the file as it is now, in the view Recto draws it in. Invented notes. */

const NOTE = '# Basil\n\nPinch the tops.\n\n## Harvest\n\nMorning.\n'
const BOARD = '---\nkanban-plugin: board\n---\n\n## To do\n\n- [ ] [[Plant garlic]]\n'
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
  it('a note: as it will read, its added and changed lines marked, from the note as it is now', () => {
    const p = proposal([
      {
        path: 'Basil.md',
        before: NOTE,
        after: NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\nDry in the shade.\n'),
      },
    ])
    // Typed since: a line at the top. The preview has it too, and marks only the suggestion's lines.
    const preview = previewOf(p, `Seeds from Anna.\n${NOTE}`)!
    expect(preview.target.view).toBe('note')
    expect(preview.marked.map((n) => preview.text.split('\n')[n])).toEqual(['Pinch the tops weekly.', 'Dry in the shade.'])
    expect(preview.notes).toEqual(['2 lines added or changed, marked', '1 line removed'])
  })

  it('a change that no longer fits is left out, and said', () => {
    const after = NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\nDry in the shade.\n')
    const preview = previewOf(
      proposal([{ path: 'Basil.md', before: NOTE, after, states: ['pending', 'pending'] }]),
      NOTE.replace('Pinch the tops.', 'Pinch them in June.'),
    )!
    expect(preview.marked.map((n) => preview.text.split('\n')[n])).toEqual(['Dry in the shade.'])
    expect(preview.notes.at(-1)).toBe('1 change no longer fits and is left out')
  })

  it('a card for a board: the board, as it will look - not the card’s note', () => {
    const p = proposal([
      { path: 'Recto/Boards/B/B.md', before: BOARD, after: `${BOARD}- [ ] [[Ship it]]\n` },
      { path: 'Recto/Boards/B/Ship it.md', before: null, after: '# Ship it\n' },
    ])
    const preview = previewOf(p, BOARD)!
    expect(preview.target).toMatchObject({ view: 'board', path: 'Recto/Boards/B/B.md' })
    expect(preview.text).toContain('[[Ship it]]')
    // The new card, outlined in the preview.
    expect(preview.markedNodes).toEqual(['Ship it'])
  })

  it('a canvas’s edits: the canvas with them made, said in words; a new canvas drawn as a canvas, not as its JSON', () => {
    const canvas = JSON.stringify({
      nodes: [{ id: 'aaaaaaaaaaaaaaaa', type: 'text', text: 'Soil', x: 0, y: 0, width: 200, height: 80 }],
      edges: [],
    })
    const p = proposal([], {
      canvas: {
        path: 'Recto/Canvas/Beds.canvas',
        ops: [
          { op: 'add-node', node: { ref: 'g1', type: 'text', text: 'Compost', x: 300, y: 0, width: 200, height: 80 } },
          { op: 'add-edge', from: 'aaaaaaaaaaaaaaaa', to: 'g1' },
        ],
        states: ['pending', 'pending'],
        refs: {},
      },
    })
    const preview = previewOf(p, canvas)!
    expect(preview.target.view).toBe('canvas')
    expect(parseCanvas(preview.text).nodes.map((n) => n.text)).toEqual(['Soil', 'Compost'])
    expect(preview.notes).toEqual(['1 card added', '1 arrow added'])
    // The new card, by the id it will have, outlined.
    const compost = parseCanvas(preview.text).nodes.find((n) => n.text === 'Compost')!
    expect(preview.markedNodes).toEqual([compost.id])
    const fresh = previewTarget(
      proposal([{ path: 'Recto/Canvas/Ideas.canvas', before: null, after: canvas }], { tool: 'canvas_propose_new' }),
    )
    expect(fresh?.view).toBe('canvas')
  })

  it('a rename, move or archive has none: its one line says it all', () => {
    expect(previewTarget(proposal([], { file: { kind: 'rename', from: 'a.md', to: 'b.md' } }))).toBeNull()
  })
})

describe('a suggestion in one line, for a chat', () => {
  it('a note’s changes and the lines they add and remove; a canvas’s cards and arrows; a new card; a rename', () => {
    expect(
      briefOf(
        proposal([
          {
            path: 'Basil.md',
            before: NOTE,
            after: NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.').replace('Morning.\n', 'Morning.\n\nDry in the shade.\n'),
          },
        ]),
      ),
    ).toBe('2 changes · 2 lines added, 1 line removed')
    expect(
      briefOf(
        proposal([], {
          canvas: {
            path: 'C.canvas',
            ops: [
              { op: 'add-node', node: { ref: 'g1', type: 'text', text: 'A', x: 0, y: 0, width: 1, height: 1 } },
              { op: 'add-node', node: { ref: 'g2', type: 'text', text: 'B', x: 0, y: 0, width: 1, height: 1 } },
              { op: 'add-edge', from: 'g1', to: 'g2' },
            ],
            states: ['pending', 'pending', 'pending'],
            refs: {},
          },
        }),
      ),
    ).toBe('2 cards, 1 arrow')
    expect(
      briefOf(
        proposal(
          [
            { path: 'Recto/Boards/B/Ship it.md', before: null, after: '# Ship it\n' },
            { path: 'Recto/Boards/B/B.md', before: BOARD, after: `${BOARD}- [ ] [[Ship it]]\n` },
          ],
          { tool: 'propose_task' },
        ),
      ),
    ).toBe('New card “Ship it”')
    expect(briefOf(proposal([], { file: { kind: 'rename', from: 'Garden/Soil.md', to: 'Garden/Garden soil.md' } }))).toBe(
      '“Soil” → “Garden soil”',
    )
  })
})
