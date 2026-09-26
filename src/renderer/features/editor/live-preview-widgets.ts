/**
 * The widgets live preview draws in place of markdown syntax: task boxes,
 * link labels, bullets and images.
 */

import { Decoration, WidgetType, type EditorView } from '@codemirror/view'
import { vaultFileUrl } from '../../app/vault-url'

export const hidden = Decoration.replace({})

/**
 * The visible half of `[text](target)`.
 *
 * Live Preview already hides the brackets and the URL, so what is left reads
 * as a link and behaved like plain prose: nothing to click. The target rides
 * along as an attribute, so the click handler does not have to re-parse the
 * line to find out where it goes.
 */
export const mdLink = (href: string): Decoration => Decoration.mark({ class: 'cm-mdlink', attributes: { 'data-href': href } })

/** A real checkbox in place of `[ ]` / `[x]`. */
export class TaskBox extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly pos: number,
  ) {
    super()
  }

  override eq(other: TaskBox): boolean {
    return other.checked === this.checked && other.pos === this.pos
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-task-checkbox'
    box.addEventListener('mousedown', (event) => {
      // Editing the document from a widget: replace just the marker text, so
      // undo treats it as one small edit rather than a rewrite.
      event.preventDefault()
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' },
        userEvent: 'input.toggle-task',
      })
    })
    return box
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/** Rendered `[[target]]` — the alias when there is one, else the target. */
export class LinkLabel extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly unresolved: boolean,
  ) {
    super()
  }

  override eq(other: LinkLabel): boolean {
    return other.label === this.label && other.unresolved === this.unresolved
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-wikilink${this.unresolved ? ' cm-wikilink-unresolved' : ''}`
    span.textContent = this.label
    return span
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/**
 * The `•` a bullet list is asking for.
 *
 * `-` is what the file says and what every other markdown tool expects, so the
 * document keeps it; a dash just reads as a stray hyphen down the left margin
 * rather than as a list. A widget, not a CSS `::marker`, because CodeMirror's
 * lines are not list elements and never will be.
 */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  override toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'cm-bullet'
    // The dot itself is drawn in CSS (`.cm-bullet::before`), so its size does
    // not depend on the font's bullet glyph and its box is exactly the two
    // columns the `- ` it replaces occupied.
    dot.textContent = ''
    return dot
  }
}

/** An image embed. Rendered as the picture, not as its markdown. */
export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
  ) {
    super()
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-image'
    const url = vaultFileUrl(this.src)
    if (url === '') {
      wrap.textContent = this.alt
      return wrap
    }
    const img = document.createElement('img')
    img.src = url
    img.alt = this.alt
    img.loading = 'lazy'
    // A missing file must say so rather than leaving a broken-image glyph with
    // no clue which path failed.
    img.addEventListener('error', () => {
      wrap.classList.add('is-missing')
      wrap.textContent = `Image not found: ${this.src}`
    })
    wrap.appendChild(img)
    return wrap
  }

  override ignoreEvent(): boolean {
    return false
  }
}

export const bullet = Decoration.replace({ widget: new BulletWidget() })
