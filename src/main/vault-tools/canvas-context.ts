import { childrenOf, parseCanvas, type CanvasNode } from '../../shared/canvas'
import { isExcludedPath } from '../../shared/ai-access'
import { readNote, titleOf, type Scope } from './scope'
import * as vaultFs from '../vault-fs'

/**
 * What Quick ask is given about an open canvas: the selected nodes - a
 * group's with everything it holds - or the whole canvas when nothing is
 * selected. Cards by their text, notes by their name and the start of their
 * text, other files, web links and groups by what they are, and the arrows
 * between them. A note AI may not see (an excluded folder) is there as a
 * place, never its name or text. Cut to a budget, notes' text first to go.
 */

/** About 4 characters to a token. */
const CHARS_PER_TOKEN = 4
/** How much of a note's text goes with it, at most. */
const NOTE_CHARS = 600

export type CanvasContext = {
  /** The canvas as the model reads it. */
  text: string
  /** The visible notes and other files on it: what the model may read with its tools (read_note, read_file). */
  notes: Set<string>
}

/** A canvas's name, as a person calls it: its file name without `.canvas`. */
export const canvasTitle = (path: string): string => titleOf(path).replace(/\.canvas$/i, '')

/** What a node is called in the text the model reads; an unseen note or file is never named. */
function nameOf(scope: Scope, node: CanvasNode): string {
  if (node.type === 'text') return `card “${(node.text ?? '').trim().split('\n')[0]!.slice(0, 60)}”`
  if (node.type === 'file' && typeof node.file === 'string') {
    if (node.file.toLowerCase().endsWith('.md'))
      return scope.hidden(node.file) || !scope.allNotes.includes(node.file) ? 'a note AI may not see' : `note “${titleOf(node.file)}”`
    return isExcludedPath(node.file, scope.settings.excluded) ? 'a file AI may not see' : `file ${node.file}`
  }
  if (node.type === 'link' && typeof node.url === 'string') return `link ${node.url}`
  if (node.type === 'group') return `group “${typeof node.label === 'string' && node.label !== '' ? node.label : 'unnamed'}”`
  return 'a node'
}

export async function canvasContext(scope: Scope, path: string, selection: readonly string[], budgetTokens: number): Promise<CanvasContext | null> {
  if (isExcludedPath(path, scope.settings.excluded)) return null
  const read = await vaultFs.readFile(path)
  if (!read.ok) return null
  const doc = parseCanvas(read.content)

  const picked = new Set(selection.filter((id) => doc.nodes.some((n) => n.id === id)))
  for (const n of doc.nodes) if (picked.has(n.id) && n.type === 'group') for (const c of childrenOf(doc, n)) picked.add(c.id)
  const nodes = picked.size === 0 ? doc.nodes : doc.nodes.filter((n) => picked.has(n.id))

  const notes = new Set<string>()
  const names = new Map(doc.nodes.map((n) => [n.id, nameOf(scope, n)]))
  const label = (node: CanvasNode): string => names.get(node.id) ?? 'a node'
  const lines: string[] = []
  const excerpts: string[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = (node.text ?? '').trim()
      if (text === '') continue
      lines.push(`- Card: ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`)
    } else if (node.type === 'file' && typeof node.file === 'string') {
      if (node.file.toLowerCase().endsWith('.md')) {
        if (scope.hidden(node.file) || !scope.allNotes.includes(node.file)) {
          lines.push('- A note AI may not see')
          continue
        }
        notes.add(node.file)
        lines.push(`- Note “${titleOf(node.file)}” (${node.file})`)
        const text = await readNote(node.file).catch(() => '')
        if (text.trim() !== '') excerpts.push(`### ${titleOf(node.file)}\n${text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS)}…` : text}`)
      } else if (isExcludedPath(node.file, scope.settings.excluded)) {
        lines.push('- A file AI may not see')
      } else {
        notes.add(node.file)
        lines.push(`- File: ${node.file}`)
      }
    } else if (node.type === 'link' && typeof node.url === 'string') {
      lines.push(`- Web link: ${node.url}`)
    } else if (node.type === 'group') {
      lines.push(`- ${label(node).replace(/^group/, 'Group')}, holding: ${childrenOf(doc, node).map(label).join(', ') || 'nothing'}`)
    }
  }
  const shown = new Set(nodes.map((n) => n.id))
  const arrows = doc.edges
    .filter((e) => shown.has(e.fromNode) && shown.has(e.toNode))
    .map((e) => {
      const from = doc.nodes.find((n) => n.id === e.fromNode)!
      const to = doc.nodes.find((n) => n.id === e.toNode)!
      return `- ${label(from)} → ${label(to)}${typeof e.label === 'string' && e.label !== '' ? ` (“${e.label}”)` : ''}`
    })

  const head = `${picked.size === 0 ? `The whole canvas “${canvasTitle(path)}”` : `${nodes.length} selected on the canvas “${canvasTitle(path)}”`}:\n${lines.join('\n')}${arrows.length === 0 ? '' : `\n\nArrows:\n${arrows.join('\n')}`}`
  // The notes' text, as far as the budget goes: the map of the canvas always comes first.
  let text = head
  for (const excerpt of excerpts) {
    if ((text.length + excerpt.length) / CHARS_PER_TOKEN > budgetTokens) break
    text += `${text === head ? '\n\nThe notes, from their start:\n\n' : '\n\n'}${excerpt}`
  }
  return { text, notes }
}
