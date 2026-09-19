import { describe, expect, it } from 'vitest'
import type { FileNode } from '../src/shared/ipc-contract'
import { coerceOrder, moveWithin, orderChildren, placeInto, pruneOrder } from '../src/renderer/core/tree-order'

const folder = (name: string, parent = ''): FileNode => ({
  name,
  path: parent === '' ? name : `${parent}/${name}`,
  kind: 'folder',
  children: [],
})
const file = (name: string, parent = ''): FileNode => ({
  name,
  path: parent === '' ? name : `${parent}/${name}`,
  kind: 'file',
})

const names = (nodes: readonly FileNode[]): string[] => nodes.map((n) => n.name)

describe('orderChildren', () => {
  const kids = [file('b.md'), folder('Zebra'), file('a.md'), folder('Apple')]

  it('falls back to folders first, then name', () => {
    expect(names(orderChildren(kids, {}, ''))).toEqual(['Apple', 'Zebra', 'a.md', 'b.md'])
  })

  it('follows the arrangement when there is one', () => {
    const order = { '': ['Zebra', 'Apple', 'b.md', 'a.md'] }
    expect(names(orderChildren(kids, order, ''))).toEqual(['Zebra', 'Apple', 'b.md', 'a.md'])
  })

  it('puts anything unlisted after what is listed, by the old rule', () => {
    const order = { '': ['Zebra'] }
    expect(names(orderChildren(kids, order, ''))).toEqual(['Zebra', 'Apple', 'a.md', 'b.md'])
  })

  it('ignores an arrangement belonging to another folder', () => {
    expect(names(orderChildren(kids, { Daily: ['Zebra'] }, ''))).toEqual(['Apple', 'Zebra', 'a.md', 'b.md'])
  })
})

describe('moveWithin', () => {
  const kids = [folder('A'), folder('B'), folder('C')]

  it('moves a folder above another', () => {
    expect(moveWithin(kids, {}, '', 'C', 'A', 'before')['']).toEqual(['C', 'A', 'B'])
  })

  it('moves a folder below another', () => {
    expect(moveWithin(kids, {}, '', 'A', 'C', 'after')['']).toEqual(['B', 'C', 'A'])
  })

  it('stores the whole sibling list, not just what moved', () => {
    const next = moveWithin([...kids, file('n.md')], {}, '', 'B', 'A', 'before')
    expect(next['']).toEqual(['B', 'A', 'C', 'n.md'])
  })

  it('does nothing when dropped on itself', () => {
    expect(moveWithin(kids, {}, '', 'A', 'A', 'before')).toEqual({})
  })

  it('keeps arrangements of other folders', () => {
    const next = moveWithin(kids, { Daily: ['x'] }, '', 'C', 'A', 'before')
    expect(next['Daily']).toEqual(['x'])
  })
})

describe('placeInto', () => {
  it('inserts a newcomer at the drop point', () => {
    const kids = [folder('A'), folder('B')]
    expect(placeInto(kids, {}, '', 'New', 'B', 'before')['']).toEqual(['A', 'New', 'B'])
  })

  it('appends when the target is gone', () => {
    const kids = [folder('A')]
    expect(placeInto(kids, {}, '', 'New', 'missing', 'after')['']).toEqual(['A', 'New'])
  })
})

describe('coerceOrder', () => {
  it('keeps string lists and drops everything else', () => {
    expect(coerceOrder({ '': ['a', 1, 'b'], bad: 'nope', Daily: [] })).toEqual({ '': ['a', 'b'] })
  })

  it('survives rubbish', () => {
    expect(coerceOrder(null)).toEqual({})
    expect(coerceOrder(['a'])).toEqual({})
  })
})

describe('pruneOrder', () => {
  it('forgets folders that are gone, and keeps the root', () => {
    const order = { '': ['a'], Daily: ['x'], Gone: ['y'] }
    expect(pruneOrder(order, (p) => p === 'Daily')).toEqual({ '': ['a'], Daily: ['x'] })
  })
})
