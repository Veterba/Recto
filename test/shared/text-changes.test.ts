import { describe, expect, it } from 'vitest'
import { appendLine, applyChanges, changesOf } from '../../src/shared/text-changes'

/** A suggested edit as separate changes, applied to the note as it is now. Invented notes. */

const NOTE = ['# Basil', '', 'Pinch the tops.', 'Water at the root.', '', '## Harvest', '', 'Morning, before the heat.', ''].join('\n')
const EDITED = [
  '# Basil',
  '',
  'Pinch the tops weekly.',
  'Water at the root.',
  '',
  '## Harvest',
  '',
  'Morning, before the heat.',
  'Dry the leaves in the shade.',
  '',
].join('\n')

describe('changes of a suggested edit', () => {
  it('splits it into its separate changes, top to bottom', () => {
    const changes = changesOf(NOTE, EDITED)
    expect(changes.map((c) => ({ removed: c.removed, added: c.added }))).toEqual([
      { removed: ['Pinch the tops.'], added: ['Pinch the tops weekly.'] },
      { removed: [], added: ['Dry the leaves in the shade.'] },
    ])
  })

  it('all of them applied give the suggested text; one of them, only that change', () => {
    const changes = changesOf(NOTE, EDITED)
    expect(applyChanges(NOTE, changes, [0, 1]).text).toBe(EDITED)
    const second = applyChanges(NOTE, changes, [1])
    expect(second.text).toBe(NOTE.replace('the heat.\n', 'the heat.\nDry the leaves in the shade.\n'))
    expect([...second.states]).toEqual([[1, 'accepted']])
  })

  it('an unrelated edit elsewhere in the note - a line typed, a trailing newline - leaves it applicable', () => {
    const changes = changesOf(NOTE, EDITED)
    const now = `Seeds from Anna.\n${NOTE}\n`
    const done = applyChanges(now, changes, [0, 1])
    expect([...done.states.values()]).toEqual(['accepted', 'accepted'])
    expect(done.text).toBe(`Seeds from Anna.\n${EDITED}\n`)
  })

  it('a second suggestion on the same note still applies after the first', () => {
    const first = changesOf(NOTE, NOTE.replace('Pinch the tops.', 'Pinch the tops weekly.'))
    const second = changesOf(NOTE, NOTE.replace('Water at the root.', 'Water at the root, never the leaves.'))
    const afterFirst = applyChanges(NOTE, first, [0]).text!
    const afterBoth = applyChanges(afterFirst, second, [0])
    expect([...afterBoth.states.values()]).toEqual(['accepted'])
    expect(afterBoth.text).toContain('Pinch the tops weekly.\nWater at the root, never the leaves.')
  })

  it('a change whose own lines were edited since is out of date; the others still go in', () => {
    const changes = changesOf(NOTE, EDITED)
    const now = NOTE.replace('Pinch the tops.', 'Pinch the tops in June.')
    const done = applyChanges(now, changes, [0, 1])
    expect(done.states.get(0)).toBe('stale')
    expect(done.states.get(1)).toBe('accepted')
    expect(done.text).toContain('Pinch the tops in June.')
    expect(done.text).toContain('Dry the leaves in the shade.')
  })

  it('a line found twice is told apart by the lines around it', () => {
    const before = ['## Monday', '- Water', '', '## Tuesday', '- Water', ''].join('\n')
    const after = before.replace('## Tuesday\n- Water', '## Tuesday\n- Water twice')
    const done = applyChanges(before, changesOf(before, after), [0])
    expect(done.text).toBe(after)
  })

  it('a new note is all of it, and out of date once a note is there', () => {
    const changes = changesOf(null, '# Watering\n\nAt the root.\n')
    expect(applyChanges(null, changes, [0])).toMatchObject({ text: '# Watering\n\nAt the root.\n' })
    expect(applyChanges('# Someone else’s\n', changes, [0]).states.get(0)).toBe('stale')
  })

  it('keeps the note’s line ends: a note from Windows stays \\r\\n', () => {
    const before = NOTE.replace(/\n/g, '\r\n')
    const after = EDITED.replace(/\n/g, '\r\n')
    expect(applyChanges(before, changesOf(before, after), [0, 1]).text).toBe(after)
  })
})

describe('a line added at the end', () => {
  it('on a line of its own, in the note’s line ends', () => {
    expect(appendLine('# Soil\nLoam.\n', '[[Basil]]')).toBe('# Soil\nLoam.\n[[Basil]]\n')
    expect(appendLine('# Soil\nLoam.', '[[Basil]]')).toBe('# Soil\nLoam.\n[[Basil]]\n')
    expect(appendLine('# Soil\r\nLoam.\r\n', '[[Basil]]')).toBe('# Soil\r\nLoam.\r\n[[Basil]]\r\n')
    expect(appendLine('', '[[Basil]]')).toBe('[[Basil]]\n')
  })
})
