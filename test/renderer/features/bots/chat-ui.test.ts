import { describe, expect, it } from 'vitest'
import { groupMessages } from '../../../../src/renderer/features/bots/grouping'
import { parseBlocks, parseInline } from '../../../../src/renderer/features/bots/markdown'

const at = (minute: number, second = 0): string => `2026-10-02T15:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`

describe('grouping', () => {
  it('groups consecutive messages from one side within three minutes', () => {
    const groups = groupMessages([
      { role: 'user', at: at(0) },
      { role: 'user', at: at(2) },
      { role: 'assistant', at: at(2, 30) },
      { role: 'assistant', at: at(3) },
      { role: 'user', at: at(10) },
      { role: 'user', at: at(14) },
    ])
    expect(groups.map((g) => g.indexes)).toEqual([[0, 1], [2, 3], [4], [5]])
  })

  it('a message with no time joins its neighbour', () => {
    expect(groupMessages([{ role: 'user' }, { role: 'user', at: at(0) }, { role: 'user' }]).map((g) => g.indexes)).toEqual([[0, 1, 2]])
  })

  it('marks where the model changed, and starts a group there', () => {
    const groups = groupMessages([
      { role: 'user', at: at(0) },
      { role: 'assistant', at: at(0), model: 'qwen3.5:9b' },
      { role: 'assistant', at: at(1), model: 'gemma4:12b' },
      { role: 'assistant', at: at(1), model: 'gemma4:12b' },
    ])
    expect(groups.map((g) => [g.indexes, g.switchedTo])).toEqual([
      [[0], null],
      [[1], null],
      [[2, 3], 'gemma4:12b'],
    ])
  })
})

describe('markdown in answers', () => {
  it('reads paragraphs, headings, lists, quotes, code and tables', () => {
    const blocks = parseBlocks(
      '# Plan\n\nFirst **bold** and *it*.\n\n- one\n- two\n\n1. a\n2. b\n\n> quoted\n\n```js\nx()\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---',
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'table', 'rule'])
  })

  it('an answer still streaming, with its code block unclosed, is code to the end', () => {
    expect(parseBlocks('Look:\n```ts\nconst a = 1')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'Look:' }] },
      { kind: 'code', lang: 'ts', code: 'const a = 1' },
    ])
  })

  it('turns [[links]] and the titles of its sources into note chips, longest title first', () => {
    expect(parseInline('See [[Soil|the soil note]] and Recto plan.', ['Recto', 'Recto plan'])).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'note', title: 'Soil', label: 'the soil note' },
      { kind: 'text', text: ' and ' },
      { kind: 'note', title: 'Recto plan', label: 'Recto plan' },
      { kind: 'text', text: '.' },
    ])
    // Not inside a longer word.
    expect(parseInline('Rectoplan', ['Recto'])).toEqual([{ kind: 'text', text: 'Rectoplan' }])
  })

  it('reads links and inline code', () => {
    expect(parseInline('Run `npm test`, see [docs](https://example.com).')).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ', see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com' },
      { kind: 'text', text: '.' },
    ])
  })
})
