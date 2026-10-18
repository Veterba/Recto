import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addLane,
  boardText,
  doneLane,
  findItem,
  insertItem,
  isKanban,
  linkStage,
  moveItem,
  parseKanban,
  rectoSettings,
  removeItem,
  removeLane,
  replaceItem,
  setChecked,
  setLaneComplete,
  setLaneHeading,
  stageOf,
  updateRecto,
  updateSettings,
} from '../../src/shared/kanban'

const FIXTURES = path.resolve(__dirname, '../fixtures/kanban')
/** Written from the plugin's own `boardToMd` (src/parsers/formats/list.ts), byte for byte. */
const derived = fs.readFileSync(path.join(FIXTURES, 'derived-board.md'), 'utf8')

/** Which lines differ between two texts, as [line, before, after]. */
function changed(before: string, after: string): [number, string | undefined, string | undefined][] {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: [number, string | undefined, string | undefined][] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([i, a[i], b[i]])
  return out
}

describe('reading a board the plugin wrote', () => {
  const board = parseKanban(derived)

  it('knows a board by its frontmatter', () => {
    expect(isKanban(derived)).toBe(true)
    expect(isKanban('---\nkanban-plugin: basic\n---\n')).toBe(true)
    expect(isKanban('---\ntitle: x\n---\n## To do\n- [ ] a')).toBe(false)
    expect(isKanban('## To do\n- [ ] a')).toBe(false)
  })

  it('reads lanes, WIP limits and the complete lane', () => {
    expect(board.lanes.map((l) => [l.title, l.wip, l.complete])).toEqual([
      ['To do', null, false],
      ['Doing', 2, false],
      ['Done', null, true],
    ])
    expect(doneLane(board.lanes)).toBe(2)
  })

  it('reads cards: notes, plain text, a date, several lines and the archive', () => {
    expect(board.lanes[0]!.items.map((i) => [i.text, i.link, i.checked])).toEqual([
      ['[[Write the announcement]]', 'Write the announcement', false],
      ['Buy stamps', null, false],
      ['Call the printer @{2026-10-20}', null, false],
    ])
    expect(board.lanes[1]!.items[1]!.text).toBe('Draft the plan\nwith a second line')
    expect(board.lanes[1]!.items[1]!.end - board.lanes[1]!.items[1]!.start).toBe(2)
    expect(board.lanes[2]!.items[0]).toMatchObject({ link: 'Design the icon', checked: true })
    expect(board.archive.map((i) => i.text)).toEqual(['Old card'])
  })

  it('keeps every key of the settings block', () => {
    expect(board.settings).toEqual({ 'kanban-plugin': 'board', 'list-collapse': [false, false, false] })
    expect(updateSettings(derived, (s) => s)).toBe(derived)
  })

  it('writes a new board exactly as the plugin would', () => {
    const lanes = board.lanes.map((lane) => ({
      title: lane.title,
      wip: lane.wip,
      complete: lane.complete,
      items: lane.items.map((i) => ({ text: i.text, checked: i.checked })),
    }))
    const written = boardText(lanes, { 'list-collapse': [false, false, false] })
    // The plugin's layout up to the archive, which a new board does not have.
    const head = derived.slice(0, derived.indexOf('***'))
    expect(written.slice(0, head.length)).toBe(head)
    expect(written.slice(head.length)).toBe(
      '\n\n%% kanban:settings\n```\n{"kanban-plugin":"board","list-collapse":[false,false,false]}\n```\n%%',
    )
    expect(parseKanban(written).lanes.map((l) => l.items.map((i) => i.text))).toEqual(board.lanes.map((l) => l.items.map((i) => i.text)))
  })

  it('ignores headings inside code blocks and lines it does not understand', () => {
    const text = '---\nkanban-plugin: board\n---\nA note before the lanes.\n\n## A\n\nSome words.\n- [ ] one\n\nMore words.\n\n```\n## not a lane\n```\n## B\n'
    const parsed = parseKanban(text)
    expect(parsed.lanes.map((l) => l.title)).toEqual(['A', 'B'])
    expect(parsed.lanes[0]!.items.map((i) => i.text)).toEqual(['one'])
  })

  it('a block that does not parse is never written over', () => {
    const broken = derived.replace('{"kanban-plugin":"board"', '{"kanban-plugin":')
    expect(parseKanban(broken).settingsBroken).toBe(true)
    expect(() => updateSettings(broken, (s) => s)).toThrow()
  })
})

describe('edits touch only their own lines', () => {
  const withStrays =
    '---\nkanban-plugin: board\ncustom: kept\n---\n\nA stray line.\n\n## To do\n\n- [ ] [[A]]\n- [ ] [[B]]\n\nWords between lanes.\n\n\n## Doing\n\n- [ ] [[C]]\n\n\n## Done\n\n**Complete**\n- [x] [[D]]\n\n\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board","x-unknown":1}\n```\n%%'

  it('a move within a lane swaps two lines', () => {
    const next = moveItem(withStrays, { lane: 0, index: 1 }, { lane: 0, index: 0 })
    expect(changed(withStrays, next)).toEqual([
      [9, '- [ ] [[A]]', '- [ ] [[B]]'],
      [10, '- [ ] [[B]]', '- [ ] [[A]]'],
    ])
  })

  it('a move between lanes removes one line and adds it there; strays and settings stay', () => {
    const next = moveItem(withStrays, { lane: 0, index: 0 }, { lane: 1, index: 1 })
    expect(next.split('\n').filter((l) => !withStrays.split('\n').includes(l))).toEqual([])
    expect(parseKanban(next).lanes.map((l) => l.items.map((i) => i.link))).toEqual([['B'], ['C', 'A'], ['D']])
    for (const line of ['A stray line.', 'Words between lanes.', 'custom: kept', '{"kanban-plugin":"board","x-unknown":1}']) expect(next).toContain(line)
    expect(next.split('\n')).toHaveLength(withStrays.split('\n').length)
  })

  it('into the done lane it is ticked, and unticked on the way out', () => {
    const into = moveItem(withStrays, { lane: 1, index: 0 }, { lane: 2, index: 0 }, true)
    expect(parseKanban(into).lanes[2]!.items.map((i) => [i.link, i.checked])).toEqual([
      ['C', true],
      ['D', true],
    ])
    expect(into).toContain('**Complete**\n- [x] [[C]]\n- [x] [[D]]')
    const out = moveItem(into, { lane: 2, index: 0 }, { lane: 0, index: 0 }, false)
    expect(out).toContain('- [ ] [[C]]\n- [ ] [[A]]')
  })

  it('a card goes into an empty lane under its heading, with the list apart from the next heading', () => {
    const text = '---\nkanban-plugin: board\n---\n\n## A\n\n- [ ] one\n\n\n## B\n\n\n\n## C\n## D\n'
    const toB = moveItem(text, { lane: 0, index: 0 }, { lane: 1, index: 0 })
    expect(toB).toContain('## B\n\n- [ ] one\n')
    const toD = moveItem(text, { lane: 0, index: 0 }, { lane: 2, index: 0 })
    expect(toD).toContain('## C\n- [ ] one\n\n## D')
  })

  it('a multi-line card moves with its continuation lines', () => {
    const next = moveItem(derived, { lane: 1, index: 1 }, { lane: 0, index: 0 })
    expect(next).toContain('## To do\n\n- [ ] Draft the plan\n    with a second line\n- [ ] [[Write the announcement]]')
    expect(parseKanban(next).archive).toHaveLength(1)
  })

  it('ticks with one character', () => {
    const next = setChecked(withStrays, { lane: 0, index: 0 }, true)
    expect(changed(withStrays, next)).toEqual([[9, '- [ ] [[A]]', '- [x] [[A]]']])
    expect(setChecked(next, { lane: 0, index: 0 }, true)).toBe(next)
  })

  it('a new card goes at the top of its lane', () => {
    const next = insertItem(withStrays, 1, 0, '[[New]]')
    expect(changed(withStrays, next)[0]).toEqual([17, '- [ ] [[C]]', '- [ ] [[New]]'])
    expect(parseKanban(next).lanes[1]!.items.map((i) => i.link)).toEqual(['New', 'C'])
  })

  it('a light card becomes a note link in place', () => {
    const next = replaceItem(derived, { lane: 0, index: 1 }, '[[Buy stamps]]')
    expect(changed(derived, next)).toEqual([[9, '- [ ] Buy stamps', '- [ ] [[Buy stamps]]']])
  })

  it('removes a card and nothing else', () => {
    const next = removeItem(derived, { lane: 1, index: 1 })
    expect(next).toBe(derived.replace('- [ ] Draft the plan\n    with a second line\n', ''))
  })

  it('renames a lane and sets its WIP limit in the heading', () => {
    expect(setLaneHeading(derived, 1, 'In progress', 3)).toBe(derived.replace('## Doing (2)', '## In progress (3)'))
    expect(setLaneHeading(derived, 1, 'Doing', null)).toBe(derived.replace('## Doing (2)', '## Doing'))
  })

  it('marks and unmarks the done lane', () => {
    const off = setLaneComplete(derived, 2, false)
    expect(off).toBe(derived.replace('**Complete**\n', ''))
    expect(setLaneComplete(off, 2, true)).toBe(derived)
  })

  it('adds a lane before the archive and deletes an empty one', () => {
    const added = addLane(derived, 'Later')
    const lanes = parseKanban(added).lanes
    expect(lanes.map((l) => l.title)).toEqual(['To do', 'Doing', 'Done', 'Later'])
    expect(parseKanban(added).archive).toHaveLength(1)
    expect(removeLane(added, 3)).not.toContain('## Later')
    expect(parseKanban(removeLane(added, 3)).lanes).toHaveLength(3)
    expect(() => removeLane(derived, 0)).toThrow()
  })

  it("keeps Recto's settings under one key, every other key untouched", () => {
    const next = updateRecto(derived, { sort: 'due', lanes: { Doing: { color: 'orange' } } })
    const board = parseKanban(next)
    expect(board.settings['list-collapse']).toEqual([false, false, false])
    expect(rectoSettings(board)).toEqual({ sort: 'due', lanes: { Doing: { color: 'orange' } } })
    expect(changed(derived, next)).toHaveLength(1)
    expect(updateRecto(next, { sort: undefined, lanes: undefined })).toBe(derived)
  })

  it('finds a card again after the file changed under it', () => {
    const board = parseKanban(derived)
    const raw = board.lanes[0]!.items[1]!.raw
    const shifted = parseKanban(insertItem(derived, 0, 0, 'Someone else'))
    expect(findItem(shifted, { lane: 0, index: 1 }, raw)).toEqual({ lane: 0, index: 2 })
    expect(findItem(shifted, { lane: 0, index: 1 }, '- [ ] gone')).toBeNull()
  })
})

describe('where a card stands', () => {
  const lanes = [
    { title: 'To do', complete: false },
    { title: 'Doing', complete: false },
    { title: 'Review', complete: false },
    { title: 'Shipped', complete: true },
  ]

  it('first lane open, done lane done, anything else doing', () => {
    expect([0, 1, 2, 3].map((i) => stageOf(i, lanes))).toEqual(['open', 'doing', 'doing', 'done'])
  })

  it('a lane called Done counts when none is marked', () => {
    expect(doneLane([{ title: 'A', complete: false }, { title: 'Done', complete: false }])).toBe(1)
    expect(doneLane([{ title: 'A', complete: false }])).toBe(-1)
  })

  it('on several boards: one stage when they agree, mixed when not', () => {
    expect(linkStage([])).toBeNull()
    expect(linkStage(['done', 'done'])).toBe('done')
    expect(linkStage(['open', 'done'])).toBe('mixed')
  })
})

describe('a board saved by Obsidian with the Kanban plugin', () => {
  // Waiting for a real export (lanes, a WIP limit, a complete lane, plain text,
  // a [[link]], a multi-line card, a dated card and an archived item). Until
  // then `derived-board.md`, written from the plugin's own boardToMd, stands in.
  it.todo('reads it, and an edit changes only the lines it means to')
})
