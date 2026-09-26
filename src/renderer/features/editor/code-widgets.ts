/**
 * The widgets on a code block: its copy button and its language label.
 */

import { WidgetType, type EditorView } from '@codemirror/view'

/** Copy the code in a fence. Positioned at the opening fence line. */
export class CopyButton extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  override eq(other: CopyButton): boolean {
    return other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.className = 'cm-code-copy'
    button.type = 'button'
    button.title = 'Copy code'
    button.setAttribute('aria-label', 'Copy code')
    button.textContent = 'Copy'
    button.addEventListener('mousedown', (event) => {
      // mousedown, not click: the editor would otherwise move the cursor into
      // the code block before the handler runs.
      event.preventDefault()
      const text = view.state.doc.sliceString(this.from, this.to)
      void navigator.clipboard.writeText(text).then(
        () => {
          button.textContent = 'Copied'
          button.classList.add('is-done')
          window.setTimeout(() => {
            button.textContent = 'Copy'
            button.classList.remove('is-done')
          }, 1200)
        },
        () => {
          // Clipboard access can be refused; saying so beats doing nothing.
          button.textContent = 'Failed'
        },
      )
    })
    return button
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/** The `python` in ```python, shown as a chip on the fence. */
export class LanguageLabel extends WidgetType {
  constructor(private readonly language: string) {
    super()
  }

  override eq(other: LanguageLabel): boolean {
    return other.language === this.language
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-code-lang'
    span.textContent = this.language
    return span
  }
}
