import type { LinkKind } from '../../app/link-kinds'

/**
 * The icon inside a link to a board or a card, drawn for CodeMirror (not
 * React): a board, or where the card stands - an open circle in its first
 * column, half filled on its way, a check when done, and a dashed circle when
 * it is on several boards that disagree. Lucide's shapes, at text size.
 */

const SVG = 'http://www.w3.org/2000/svg'

/** What each icon says, for the tooltip and screen readers. */
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  board: 'Board',
  open: 'Task, not started',
  doing: 'Task, in progress',
  done: 'Task, done',
  mixed: 'Task, on several boards',
}

type Shape = { tag: 'path' | 'circle' | 'rect'; attrs: Record<string, string> }

const RING: Shape = { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } }

const SHAPES: Record<LinkKind, Shape[]> = {
  board: [
    { tag: 'rect', attrs: { x: '3', y: '3', width: '18', height: '18', rx: '2' } },
    { tag: 'path', attrs: { d: 'M8 7v7' } },
    { tag: 'path', attrs: { d: 'M12 7v4' } },
    { tag: 'path', attrs: { d: 'M16 7v9' } },
  ],
  open: [RING],
  doing: [RING, { tag: 'path', attrs: { d: 'M12 3a9 9 0 0 1 0 18z', fill: 'currentColor' } }],
  done: [RING, { tag: 'path', attrs: { d: 'm8.5 12 2.5 2.5 4.5-5' } }],
  mixed: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '9', 'stroke-dasharray': '3.5 3' } }],
}

export function linkIcon(kind: LinkKind): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = `cm-link-icon cm-link-icon--${kind}`
  span.title = LINK_KIND_LABEL[kind]
  span.setAttribute('aria-label', LINK_KIND_LABEL[kind])
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.25',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value)
  for (const shape of SHAPES[kind]) {
    const el = document.createElementNS(SVG, shape.tag)
    for (const [name, value] of Object.entries(shape.attrs)) el.setAttribute(name, value)
    svg.append(el)
  }
  span.append(svg)
  return span
}
