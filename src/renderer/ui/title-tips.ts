import { placeTip } from './Tip'
import { metaHeld, subscribeMeta } from './meta-key'

/**
 * Every `title` in the window, shown the way Tip shows its label: only while
 * ⌘ is held over the element, in the app's own bubble.
 *
 * The browser's own title tooltip cannot be told to wait for a key, so the
 * attribute is moved to `data-tip-title` the first time the pointer reaches
 * the element, and this layer draws it instead. An element left with no name
 * of its own (an icon button) gets the text as its `aria-label`, so moving the
 * title takes nothing from a screen reader. One listener for the whole app,
 * rather than every `title` in every component rewritten as a Tip.
 */

const ATTR = 'data-tip-title'

export function installTitleTips(): void {
  let current: HTMLElement | null = null
  let bubble: HTMLDivElement | null = null

  const hide = (): void => {
    bubble?.remove()
    bubble = null
  }

  const update = (): void => {
    const text = current?.getAttribute(ATTR) ?? ''
    if (current === null || !current.isConnected || text === '' || !metaHeld()) return hide()
    if (bubble?.textContent === text) return
    hide()
    bubble = document.createElement('div')
    bubble.className = 'tip'
    bubble.setAttribute('role', 'tooltip')
    const label = document.createElement('span')
    label.className = 'tip__label'
    label.textContent = text
    bubble.append(label)
    document.body.append(bubble)
    const at = placeTip(current.getBoundingClientRect(), bubble.getBoundingClientRect(), 'bottom')
    bubble.style.left = `${at.x}px`
    bubble.style.top = `${at.y}px`
  }

  document.addEventListener(
    'pointerover',
    (event) => {
      const found = (event.target as Element | null)?.closest?.<HTMLElement>(`[title], [${ATTR}]`) ?? null
      // A frame's title names the document inside it; it is not a tooltip.
      const next = found?.tagName === 'IFRAME' ? null : found
      if (next !== null && next.hasAttribute('title')) {
        const text = next.getAttribute('title') ?? ''
        next.removeAttribute('title')
        next.setAttribute(ATTR, text)
        if (!next.hasAttribute('aria-label') && (next.textContent ?? '').trim() === '') next.setAttribute('aria-label', text)
      }
      if (next !== current) {
        current = next
        hide()
      }
      update()
    },
    true,
  )
  // A tooltip that survives the click it describes is noise.
  document.addEventListener('pointerdown', hide, true)
  subscribeMeta(update)
}
