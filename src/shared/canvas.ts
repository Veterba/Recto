/**
 * JSON Canvas (jsoncanvas.org, spec 1.0) - Obsidian's .canvas files - read
 * and written without losing anything.
 *
 * A canvas file is the user's, and Obsidian opens it too. So every node and
 * edge is kept as the object it was read as: keys Recto does not know - a
 * plugin's, or a later spec's - stay where they were, in their order, and a
 * node of a type Recto does not draw is kept whole. Changing a node changes
 * only its own keys. The file is written the way Obsidian writes it (tabs,
 * one node or edge per line), so a node left alone keeps its line exactly and
 * a change is a one-line diff.
 */

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'
export type CanvasEnd = 'none' | 'arrow'
export type CanvasNodeType = 'text' | 'file' | 'link' | 'group'

/** A node as read, every key it had. The fields Recto understands are typed; the rest ride along. */
export type CanvasNode = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  background?: string
  backgroundStyle?: string
  [key: string]: unknown
}

export type CanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  fromSide?: CanvasSide
  toSide?: CanvasSide
  fromEnd?: CanvasEnd
  toEnd?: CanvasEnd
  color?: string
  label?: string
  [key: string]: unknown
}

export type CanvasDoc = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** Top-level keys besides nodes and edges (a plugin's metadata, say), in their order. */
  rest: Record<string, unknown>
  /** Where nodes and edges came in the file, so they are written back in that order. */
  order: ('nodes' | 'edges' | string)[]
}

export class CanvasParseError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A canvas from its file. An empty file is an empty canvas (Obsidian makes
 * them). A node without the fields every node must have is refused: drawing
 * it at 0,0 and writing that back would change the file.
 */
export function parseCanvas(text: string): CanvasDoc {
  if (text.trim() === '') return { nodes: [], edges: [], rest: {}, order: ['nodes', 'edges'] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new CanvasParseError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isObject(raw)) throw new CanvasParseError('A canvas is a JSON object with nodes and edges.')
  const nodes = raw['nodes'] ?? []
  const edges = raw['edges'] ?? []
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new CanvasParseError('"nodes" and "edges" must be lists.')
  for (const n of nodes) {
    if (!isObject(n) || typeof n['id'] !== 'string' || typeof n['type'] !== 'string') throw new CanvasParseError('A node without an id or a type.')
    for (const k of ['x', 'y', 'width', 'height'])
      if (typeof n[k] !== 'number') throw new CanvasParseError(`Node ${String(n['id'])} has no ${k}.`)
  }
  for (const e of edges)
    if (!isObject(e) || typeof e['id'] !== 'string' || typeof e['fromNode'] !== 'string' || typeof e['toNode'] !== 'string')
      throw new CanvasParseError('An edge without an id, fromNode or toNode.')
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (k !== 'nodes' && k !== 'edges') rest[k] = v
  return { nodes: nodes as CanvasNode[], edges: edges as CanvasEdge[], rest, order: Object.keys(raw) }
}

/**
 * The file, as Obsidian writes it: a tab-indented object whose lists hold one
 * compact object per line. Other top-level keys are written compact, on their
 * own line, where they were.
 */
export function serializeCanvas(doc: CanvasDoc): string {
  const keys = [...doc.order.filter((k) => k === 'nodes' || k === 'edges' || k in doc.rest)]
  for (const k of ['nodes', 'edges']) if (!keys.includes(k)) keys.push(k)
  for (const k of Object.keys(doc.rest)) if (!keys.includes(k)) keys.push(k)
  const list = (items: readonly object[]): string =>
    items.length === 0 ? '[]' : `[\n${items.map((item) => `\t\t${JSON.stringify(item)}`).join(',\n')}\n\t]`
  const lines = keys.map((k) => {
    const value = k === 'nodes' ? list(doc.nodes) : k === 'edges' ? list(doc.edges) : JSON.stringify(doc.rest[k])
    return `\t${JSON.stringify(k)}:${value}`
  })
  return `{\n${lines.join(',\n')}\n}`
}

/** An id the way Obsidian makes them: 16 hex characters, not used in this canvas. */
export function newCanvasId(doc: CanvasDoc, random: () => number = Math.random): string {
  const taken = new Set([...doc.nodes.map((n) => n.id), ...doc.edges.map((e) => e.id)])
  for (;;) {
    let id = ''
    for (let i = 0; i < 16; i++) id += Math.floor(random() * 16).toString(16)
    if (!taken.has(id)) return id
  }
}

/**
 * The node with some keys set and some removed (`undefined`), every other key
 * where it was. Positions and sizes are whole numbers, as Obsidian writes them.
 */
export function patchNode(node: CanvasNode, patch: Partial<Record<keyof CanvasNode, unknown>>): CanvasNode {
  const next: Record<string, unknown> = { ...node }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = (k === 'x' || k === 'y' || k === 'width' || k === 'height') && typeof v === 'number' ? Math.round(v) : v
  }
  return next as CanvasNode
}

export function patchEdge(edge: CanvasEdge, patch: Partial<Record<keyof CanvasEdge, unknown>>): CanvasEdge {
  const next: Record<string, unknown> = { ...edge }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next as CanvasEdge
}

/**
 * Looks the spec has no keys for (a shape, a dashed border, a path), kept as
 * the Advanced Canvas plugin keeps them: string values under `styleAttributes`.
 * So Obsidian with that plugin draws them too; without it, the node is a plain box.
 */
export function styleOf(item: CanvasNode | CanvasEdge): Readonly<Record<string, string>> {
  const style = item['styleAttributes']
  if (typeof style !== 'object' || style === null) return {}
  return Object.fromEntries(Object.entries(style).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

/** The node or edge with some style keys set and some removed (`undefined`); no `styleAttributes` left when none is. */
export function withStyle<T extends CanvasNode | CanvasEdge>(item: T, patch: Readonly<Record<string, string | undefined>>): T {
  const old = item['styleAttributes']
  const style: Record<string, unknown> = typeof old === 'object' && old !== null ? { ...old } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete style[k]
    else style[k] = v
  }
  const next: Record<string, unknown> = { ...item, styleAttributes: style }
  if (Object.keys(style).length === 0) delete next['styleAttributes']
  return next as T
}

/** An edge's ends as drawn: the spec's defaults when the file leaves them out. */
export const edgeEnds = (edge: CanvasEdge): { from: CanvasEnd; to: CanvasEnd } => ({
  from: edge.fromEnd ?? 'none',
  to: edge.toEnd ?? 'arrow',
})

/** The six preset colours, by number; anything else is a hex colour. */
export const PRESET_COLORS = ['1', '2', '3', '4', '5', '6'] as const
export type PresetColor = (typeof PRESET_COLORS)[number]
export const isPresetColor = (color: string): color is PresetColor => (PRESET_COLORS as readonly string[]).includes(color)

/** A node Recto draws: text, file, link or group. Anything else is kept and shown as unknown. */
export const isKnownNodeType = (type: string): type is CanvasNodeType => type === 'text' || type === 'file' || type === 'link' || type === 'group'

/** The nodes a group holds: the ones wholly inside its frame, as Obsidian decides it - by where they are, not by a list. */
export function childrenOf(doc: CanvasDoc, group: CanvasNode): CanvasNode[] {
  return doc.nodes.filter(
    (n) =>
      n.id !== group.id &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height,
  )
}

/** The notes (and other files) a canvas puts on it, with the node each is in. */
export function canvasFiles(doc: CanvasDoc): { node: string; file: string; subpath: string | null }[] {
  return doc.nodes
    .filter((n) => n.type === 'file' && typeof n.file === 'string' && n.file !== '')
    .map((n) => ({ node: n.id, file: n.file!, subpath: typeof n.subpath === 'string' ? n.subpath : null }))
}

/** Every file node pointing at `from` (or into a folder `from/`) made to point at `to`. Null when none does. */
export function renameInCanvas(doc: CanvasDoc, from: string, to: string): CanvasDoc | null {
  let changed = false
  const nodes = doc.nodes.map((n) => {
    if (n.type !== 'file' || typeof n.file !== 'string') return n
    const moved = n.file === from ? to : n.file.startsWith(`${from}/`) ? `${to}${n.file.slice(from.length)}` : null
    if (moved === null) return n
    changed = true
    return patchNode(n, { file: moved })
  })
  return changed ? { ...doc, nodes } : null
}

/** What a link node shows of its page; images are data URLs, so nothing is loaded from the web when it is drawn. */
export type LinkPreview = { title: string | null; description: string | null; image: string | null; icon: string | null }
