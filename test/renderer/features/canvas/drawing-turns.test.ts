// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { inTurn } from '../../../../src/renderer/features/canvas/drawing-store'

/** Changes to one drawing run one after another, each after the one before has saved; another drawing's do not wait. */
describe('a drawing’s changes, in turn', () => {
  it('the second starts only once the first is done; a failed one does not hold up the next', async () => {
    const order: string[] = []
    const slow = (name: string, ms: number, fail = false) => async (): Promise<string> => {
      order.push(`${name} start`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`${name} end`)
      if (fail) throw new Error(name)
      return name
    }
    const first = inTurn('a.svg', slow('one', 30, true)).catch(() => 'failed')
    const second = inTurn('a.svg', slow('two', 1))
    const other = inTurn('b.svg', slow('other', 1))
    expect(await Promise.all([first, second, other])).toEqual(['failed', 'two', 'other'])
    expect(order.indexOf('two start')).toBeGreaterThan(order.indexOf('one end'))
    // Another drawing did not wait for this one's.
    expect(order.indexOf('other end')).toBeLessThan(order.indexOf('one end'))
  })
})
