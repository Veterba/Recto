import { styleOf, type CanvasDoc, type CanvasEdge, type CanvasNode } from './canvas'

/**
 * A canvas drawn as a picture for an AI to look at: every node where it is
 * and as big as it is, with its short id (n1, n2… as canvas_read lists them)
 * and the start of its text; groups as frames, arrows with their labels. A
 * model reads overlaps, gaps and tangles from this that a list of numbers
 * hides - which is why its canvases came out untidy.
 *
 * Plain SVG, drawn the same in light and dark: it is for a model, not a person.
 * Nodes the suggestion being looked at would add are drawn dashed green.
 */

/** What a node shows: its title and a few lines, or nothing (a file the AI may not see) - from canvas-tools.ts. */
export type NodeLabel = { title: string; lines: string[]; hidden?: boolean }

/** The longer side of the picture, in pixels: big enough to read a card's first lines, small enough to send. */
const MAX_SIDE = 1600
const PAD = 40
const FONT = 13

const COLORS: Readonly<Record<string, string>> = {
  '1': '#e5484d',
  '2': '#f76b15',
  '3': '#ffc53d',
  '4': '#30a46c',
  '5': '#0090ff',
  '6': '#8e4ec6',
}
const colorOf = (c: unknown): string | null => (typeof c === 'string' ? (COLORS[c] ?? (/^#[0-9a-f]{3,8}$/i.test(c) ? c : null)) : null)

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Where the line from a box's centre toward a point leaves the box: arrows start and end at edges, not centres. */
function edgePoint(r: CanvasNode, tx: number, ty: number): [number, number] {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const t = Math.min(Math.abs(r.width / 2 / (dx || Infinity)), Math.abs(r.height / 2 / (dy || Infinity)))
  return [cx + dx * Math.min(1, t), cy + dy * Math.min(1, t)]
}

/**
 * Where an arrow's end is drawn: at its pin when it has one off the centre
 * (Recto's own style key, "x,y" as fractions of the node - arrow-geometry.ts),
 * else where the line from centre to centre leaves the node.
 */
function endOf(e: CanvasEdge, end: 'from' | 'to', r: CanvasNode, other: CanvasNode): [number, number] {
  const pin = (n: CanvasNode, key: string): [number, number] | null => {
    const [fx, fy] = (styleOf(e)[key] ?? '').split(',').map(Number)
    return fx === undefined || fy === undefined || !Number.isFinite(fx) || !Number.isFinite(fy) || (fx === 0.5 && fy === 0.5)
      ? null
      : [n.x + fx * n.width, n.y + fy * n.height]
  }
  const mine = pin(r, `${end}Anchor`)
  if (mine !== null) return mine
  const there = pin(other, `${end === 'from' ? 'to' : 'from'}Anchor`) ?? [other.x + other.width / 2, other.y + other.height / 2]
  return edgePoint(r, there[0], there[1])
}

/** A text cut into lines that fit `width` (roughly: an average letter's width), at most `max` of them. */
function wrap(text: string, width: number, max: number): string[] {
  const perLine = Math.max(8, Math.floor(width / (FONT * 0.55)))
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter((w) => w !== '')) {
      if ((line + ' ' + word).trim().length > perLine) {
        if (line !== '') out.push(line)
        line = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word
      } else line = (line + ' ' + word).trim()
      if (out.length >= max) break
    }
    if (line !== '' && out.length < max) out.push(line)
    if (out.length >= max) break
  }
  return out
}

export function canvasSvg(
  doc: CanvasDoc,
  ids: ReadonlyMap<string, string>,
  label: (n: CanvasNode) => NodeLabel,
  proposed: ReadonlySet<string> = new Set(),
): { svg: string; width: number; height: number } {
  if (doc.nodes.length === 0)
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#fafafa"/><text x="200" y="104" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#666">An empty canvas</text></svg>',
      width: 400,
      height: 200,
    }
  const left = Math.min(...doc.nodes.map((n) => n.x)) - PAD
  const top = Math.min(...doc.nodes.map((n) => n.y)) - PAD - 20
  const right = Math.max(...doc.nodes.map((n) => n.x + n.width)) + PAD
  const bottom = Math.max(...doc.nodes.map((n) => n.y + n.height)) + PAD
  const w = right - left
  const h = bottom - top
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const parts: string[] = []

  // Frames first, under what they hold; then arrows; then the nodes over them.
  for (const n of doc.nodes.filter((g) => g.type === 'group')) {
    const color = colorOf(n['color']) ?? '#8b8d98'
    const dashed = proposed.has(n.id) ? ' stroke-dasharray="8 5"' : ''
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="14" fill="${color}" fill-opacity="0.06" stroke="${proposed.has(n.id) ? '#30a46c' : color}" stroke-width="2"${dashed}/>`,
      `<text x="${n.x + 6}" y="${n.y - 8}" font-size="${FONT}" font-weight="600" fill="#444">${xml(`${ids.get(n.id) ?? ''} ${typeof n.label === 'string' ? n.label : ''}`.trim())}</text>`,
    )
  }
  for (const e of doc.edges) {
    const a = byId.get(e.fromNode)
    const b = byId.get(e.toNode)
    if (a === undefined || b === undefined) continue
    const [x1, y1] = endOf(e, 'from', a, b)
    const [x2, y2] = endOf(e, 'to', b, a)
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7a7d87" stroke-width="2" marker-end="url(#head)"/>`)
    if (typeof e.label === 'string' && e.label !== '') {
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const lw = e.label.length * FONT * 0.6 + 12
      parts.push(
        `<rect x="${mx - lw / 2}" y="${my - 11}" width="${lw}" height="22" rx="6" fill="#ffffff" stroke="#d0d1d6"/>`,
        `<text x="${mx}" y="${my + 4.5}" font-size="${FONT - 1}" text-anchor="middle" fill="#333">${xml(e.label)}</text>`,
      )
    }
  }
  for (const n of doc.nodes.filter((g) => g.type !== 'group')) {
    const color = colorOf(n['color'])
    const mine = proposed.has(n.id)
    const shown = label(n)
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${shown.hidden === true ? '#eeeeef' : '#ffffff'}" stroke="${mine ? '#30a46c' : (color ?? '#c4c6cd')}" stroke-width="${mine || color !== null ? 2.5 : 1.5}"${mine ? ' stroke-dasharray="8 5"' : ''}/>`,
      `<text x="${n.x + 8}" y="${n.y + 16}" font-size="${FONT - 2}" fill="#8b8d98">${xml(ids.get(n.id) ?? '')}</text>`,
    )
    const inner = n.width - 20
    const titleLines = shown.title === '' ? [] : wrap(shown.title, inner, 2)
    const room = Math.max(0, Math.floor((n.height - 30 - titleLines.length * (FONT + 5)) / (FONT + 4)))
    let y = n.y + 34
    for (const t of titleLines) {
      parts.push(`<text x="${n.x + 10}" y="${y}" font-size="${FONT}" font-weight="600" fill="#1c1c1e">${xml(t)}</text>`)
      y += FONT + 5
    }
    for (const t of wrap(shown.lines.join('\n'), inner, room)) {
      parts.push(`<text x="${n.x + 10}" y="${y}" font-size="${FONT - 1}" fill="#444">${xml(t)}</text>`)
      y += FONT + 4
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${w} ${h}" font-family="-apple-system, Helvetica, Arial, sans-serif">`,
    '<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7a7d87"/></marker></defs>',
    `<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="#f6f6f4"/>`,
    ...parts,
    '</svg>',
  ].join('')
  return { svg, width, height }
}
