// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../../../src/renderer/ui/ConfirmDialog'
import { NoteTitle } from '../../../src/renderer/features/editor/components/NoteTitle'

/** Enter on Cancel cancels; Escape in a name field cancels instead of committing what was typed. */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(element))
  return host
}

const key = (target: Element, k: string): void => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

/** Type into a React-controlled input. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ConfirmDialog', () => {
  it('Enter on a button is left to the button: the dialog does not confirm by itself', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(createElement(ConfirmDialog, { title: 'Delete?', body: 'Gone.', confirmLabel: 'Delete', onConfirm, onCancel }))
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!
    cancel.focus()
    key(cancel, 'Enter')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter elsewhere in the dialog still confirms', () => {
    const onConfirm = vi.fn()
    render(createElement(ConfirmDialog, { title: 'Delete?', body: 'Gone.', confirmLabel: 'Delete', onConfirm, onCancel: vi.fn() }))
    key(document.querySelector('.dialog__lede')!, 'Enter')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('NoteTitle', () => {
  it('Escape puts the name back and renames nothing', () => {
    const onRename = vi.fn(async () => null)
    const host = render(createElement(NoteTitle, { path: 'Notes/Plan.md', onRename }))
    const input = host.querySelector('input')!
    input.focus()
    type(input, 'Typed by mistake')
    key(input, 'Escape')
    expect(onRename).not.toHaveBeenCalled()
    expect(input.value).toBe('Plan')
  })

  it('Enter still renames', () => {
    const onRename = vi.fn(async () => null)
    const host = render(createElement(NoteTitle, { path: 'Notes/Plan.md', onRename }))
    const input = host.querySelector('input')!
    input.focus()
    type(input, 'Roadmap')
    key(input, 'Enter')
    expect(onRename).toHaveBeenCalledWith('Roadmap')
  })
})
