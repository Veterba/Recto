import { describe, expect, it } from 'vitest'
import { shouldDismiss } from '../src/renderer/components/ContextMenu'

/**
 * Two rules, both of which were wrong, and neither of which produced an error.
 *
 * A context menu that opens and then ignores every click looks identical to one
 * that was never wired up, which is why this is pinned here rather than left to
 * be noticed.
 */

const LEFT = 0
const MIDDLE = 1
const RIGHT = 2

describe('dismissing a context menu', () => {
  it('closes on a left click outside it', () => {
    expect(shouldDismiss(LEFT, false)).toBe(true)
  })

  it('does NOT close on a click inside it', () => {
    // The listener is in the capture phase, so it runs before the click reaches
    // the button. Closing here unmounts the button between mousedown and
    // mouseup, no `click` is ever dispatched, and the menu item never runs.
    expect(shouldDismiss(LEFT, true)).toBe(false)
  })

  it('does NOT close on a right click, wherever it lands', () => {
    // A right-click is not one event: mousedown and contextmenu arrive in
    // either order depending on the device, and a trackpad secondary tap sends
    // the pair twice - so this would eat the gesture that opened the menu.
    expect(shouldDismiss(RIGHT, false)).toBe(false)
    expect(shouldDismiss(RIGHT, true)).toBe(false)
  })

  it('closes on a middle click outside, which is still a click elsewhere', () => {
    expect(shouldDismiss(MIDDLE, false)).toBe(true)
  })
})
