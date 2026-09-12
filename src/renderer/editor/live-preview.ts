import { syntaxTree } from '@codemirror/language'
import { Compartment, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * Live Preview: the markdown markers are hidden until the cursor reaches them.
 *
 * The document is never rewritten. Everything here is a *view* decoration, so
 * the file on disk stays exactly what was typed - this is the whole argument for
 * CodeMirror over a rich-text model, and Live Preview is where that argument
 * gets cashed.
 *
 * The one rule that makes it usable, and the one most clones get wrong:
 * **a line that the selection touches shows its raw syntax.** Otherwise the
 * markers you need to edit are the markers you cannot see.
 */

/** Markdown syntax node names whose marker text should be hidden. */
const MARKERS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark',
  'URL',
])

const hidden = Decoration.replace({})

/** A real checkbox in place of `[ ]` / `[x]`. */
class TaskBox extends WidgetType {
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
class LinkLabel extends WidgetType {
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

const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g
const TASK = /^(\s*[-*+]\s+)(\[[ xX]\])/

export const setLivePreview = StateEffect.define<boolean>()

const livePreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setLivePreview)) return effect.value
    }
    return value
  },
})

export const isLivePreviewOn = (view: EditorView): boolean =>
  view.state.field(livePreviewEnabled, false) ?? false

/** Line numbers the selection touches. Those lines are left raw. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(range.from).number
    const to = view.state.doc.lineAt(range.to).number
    for (let n = from; n <= to; n++) lines.add(n)
  }
  return lines
}

function build(view: EditorView, unresolved: ReadonlySet<string>): DecorationSet {
  if (!isLivePreviewOn(view)) return Decoration.none

  const active = activeLines(view)
  type Range = { from: number; to: number; deco: Decoration }
  const ranges: Range[] = []

  for (const { from, to } of view.visibleRanges) {
    // --- syntax markers, from the grammar --------------------------------
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!MARKERS.has(node.name)) return
        if (active.has(view.state.doc.lineAt(node.from).number)) return
        if (node.to <= node.from) return

        // A heading's '##' is followed by a space that should go too, or the
        // text starts one column in from the margin.
        let end = node.to
        if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
          const next = view.state.doc.sliceString(node.to, node.to + 1)
          if (next === ' ') end = node.to + 1
        }
        ranges.push({ from: node.from, to: end, deco: hidden })
      },
    })

    // --- wikilinks and tasks, which the grammar does not know ------------
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number

    for (let n = startLine; n <= endLine; n++) {
      if (active.has(n)) continue
      const line = view.state.doc.line(n)

      const task = TASK.exec(line.text)
      if (task?.[1] !== undefined && task[2] !== undefined) {
        const boxFrom = line.from + task[1].length
        ranges.push({
          from: boxFrom,
          to: boxFrom + task[2].length,
          deco: Decoration.replace({
            widget: new TaskBox(task[2] !== '[ ]', boxFrom),
          }),
        })
      }

      for (const match of line.text.matchAll(WIKILINK)) {
        const start = line.from + (match.index ?? 0)
        const end = start + match[0].length
        const target = match[1]?.trim() ?? ''
        const alias = match[3]?.slice(1).trim()
        const label = alias !== undefined && alias !== '' ? alias : target
        ranges.push({
          from: start,
          to: end,
          deco: Decoration.replace({
            widget: new LinkLabel(label, unresolved.has(target.normalize('NFC').toLowerCase())),
          }),
        })
      }
    }
  }

  // The builder demands sorted, non-overlapping ranges. Overlaps are real here:
  // a wikilink inside a heading produces both a HeaderMark and a link range.
  ranges.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  let lastTo = -1
  for (const range of ranges) {
    if (range.from < lastTo) continue
    builder.add(range.from, range.to, range.deco)
    lastTo = range.to
  }
  return builder.finish()
}

/**
 * @param getUnresolved reads the unresolved-target set from editor state, so
 * Live Preview and source mode agree on which links are broken.
 */
export function livePreview(getUnresolved: (view: EditorView) => ReadonlySet<string>): Extension {
  return [
    livePreviewEnabled,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = build(view, getUnresolved(view))
        }

        update(update: ViewUpdate): void {
          // Selection changes matter as much as document changes: moving the
          // cursor onto a line is what reveals its syntax.
          const toggled = update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(setLivePreview)),
          )
          if (update.docChanged || update.viewportChanged || update.selectionSet || toggled) {
            this.decorations = build(update.view, getUnresolved(update.view))
          }
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
        // Hidden markers behave as one unit for cursor movement, so arrowing
        // through a heading does not stop inside invisible '##' characters.
        provide: (plugin) =>
          EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
      },
    ),
  ]
}

/** Lets the mode be swapped at runtime without rebuilding the editor. */
export const livePreviewCompartment = new Compartment()
