// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installImeGuard } from '../../../src/renderer/ui/ime-guard'

/** Enter that confirms a candidate in a Chinese or Japanese input method is the input method's, not the app's. */

let uninstall = (): void => {}
afterEach(() => {
  uninstall()
  document.body.innerHTML = ''
})

const press = (target: Element, init: KeyboardEventInit): boolean => {
  let reached = false
  const listener = (): void => {
    reached = true
  }
  target.addEventListener('keydown', listener)
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  target.removeEventListener('keydown', listener)
  return reached
}

describe('keys an input method is composing with', () => {
  it("Enter, Esc, Tab and the arrows while composing never reach the app's own handlers", () => {
    uninstall = installImeGuard()
    const title = document.body.appendChild(document.createElement('input'))
    for (const key of ['Enter', 'Escape', 'Tab', 'ArrowDown']) expect(press(title, { key, isComposing: true })).toBe(false)
    // keyCode 229: how some engines mark a key the input method has.
    expect(press(title, { key: 'Enter', keyCode: 229 })).toBe(false)
  })

  it('the same keys when not composing, and letters while composing, go on as always', () => {
    uninstall = installImeGuard()
    const title = document.body.appendChild(document.createElement('input'))
    expect(press(title, { key: 'Enter' })).toBe(true)
    expect(press(title, { key: 'a', isComposing: true })).toBe(true)
  })

  it("in an editor's own text CodeMirror handles composition itself; a table cell drawn inside it is guarded", () => {
    uninstall = installImeGuard()
    const editor = document.body.appendChild(document.createElement('div'))
    editor.className = 'cm-editor'
    const content = editor.appendChild(document.createElement('div'))
    content.className = 'cm-content'
    expect(press(content, { key: 'Enter', isComposing: true })).toBe(true)
    // A table's cell is a field of its own inside the text: Enter there moved to the next cell mid-word.
    const cell = content.appendChild(document.createElement('td'))
    cell.contentEditable = 'true'
    expect(press(cell, { key: 'Enter', isComposing: true })).toBe(false)
  })
})
