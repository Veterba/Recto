import { syntaxTree } from '@codemirror/language'
import { Compartment, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { vaultFileUrl } from '../core/vault-url'
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

/** A drawn horizontal rule, in place of the `---` that produces it. */
class RuleWidget extends WidgetType {
  override eq(): boolean {
    // Every rule is identical, so CodeMirror can reuse the DOM freely.
    return true
  }

  override toDOM(): HTMLElement {
    const hr = document.createElement('div')
    hr.className = 'cm-rule'
    return hr
  }
}

/** An image embed. Rendered as the picture, not as its markdown. */
class ImageWidget extends WidgetType {
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

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g
const HIGHLIGHT = /==([^=\n]+)==/g
const TASK = /^(\s*[-*+]\s+)(\[[ xX]\])/
const FENCE_LINE = /^---\s*$/

const livePreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setLivePreview)) return effect.value
    }
    return value
  },
})

/**
 * Block-level hiding: the frontmatter block, `---` rules, and the `<div align>`
 * tags that carry paragraph alignment.
 *
 * CodeMirror refuses block decorations from a ViewPlugin ("Block decorations
 * may not be specified via plugins") - they have to come from a StateField, so
 * the editor can account for their height before it renders. Hence this second,
 * small decoration source alongside the main plugin.
 *
 * And a block range must span whole lines, ending at a line END. Ending at the
 * next line's `from` includes the newline, is not a line end, and CodeMirror
 * silently ignores the whole decoration - which looks exactly like a condition
 * that never matched.
 */
const RULE_LINE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/

const hiddenBlock = Decoration.replace({ block: true })
const ruleBlock = Decoration.replace({ block: true, widget: new RuleWidget() })

const blockHiding = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    if (!transaction.docChanged && transaction.selection === undefined && value !== Decoration.none) {
      return value.map(transaction.changes)
    }

    const state = transaction.state
    if (!(state.field(livePreviewEnabled, false) ?? false)) return Decoration.none

    const doc = state.doc
    /** Line numbers the selection touches; those stay raw. */
    const touched = new Set<number>()
    for (const range of state.selection.ranges) {
      const from = doc.lineAt(range.from).number
      const to = doc.lineAt(range.to).number
      for (let n = from; n <= to; n++) touched.add(n)
    }

    const ranges: { from: number; to: number; deco: Decoration }[] = []

    // --- frontmatter ------------------------------------------------------
    let frontmatterEnd = 0
    if (doc.lines >= 2 && FENCE_LINE.test(doc.line(1).text)) {
      for (let n = 2; n <= doc.lines; n++) {
        if (!FENCE_LINE.test(doc.line(n).text)) continue
        frontmatterEnd = n
        break
      }
      if (frontmatterEnd > 0) {
        let cursorInside = false
        for (let n = 1; n <= frontmatterEnd; n++) if (touched.has(n)) cursorInside = true
        if (!cursorInside) {
          ranges.push({ from: 0, to: doc.line(frontmatterEnd).to, deco: hiddenBlock })
        }
      }
    }

    // --- rules and code fences -------------------------------------------
    //
    // The fence lines go too, not just their backticks. Hiding only the ``` of
    // "```python" leaves the word "python" sitting inside the block, and the
    // closing fence leaves an empty row at the bottom - which is exactly what
    // a rendered code block should not have. The language is shown as a chip
    // instead, from blocks.ts.
    let inFence = false
    for (let n = frontmatterEnd + 1; n <= doc.lines; n++) {
      const line = doc.line(n)
      const isFence = FENCE.test(line.text)

      if (isFence) {
        const wasIn = inFence
        inFence = !inFence
        if (!touched.has(n)) ranges.push({ from: line.from, to: line.to, deco: hiddenBlock })
        // A closing fence ends the block; nothing else on this line matters.
        if (wasIn) continue
        continue
      }
      // Inside a fence, `---` is code and `<div>` is code. Never touch them.
      if (inFence) continue
      if (touched.has(n)) continue

      if (RULE_LINE.test(line.text)) {
        // `---` directly under a line of text is a setext H2, not a rule.
        // Drawing a line there would hide a heading.
        const previous = n > 1 ? doc.line(n - 1).text.trim() : ''
        if (previous === '' || !line.text.trim().startsWith('-')) {
          ranges.push({ from: line.from, to: line.to, deco: ruleBlock })
        }
        continue
      }
    }

    return Decoration.set(ranges.map((range) => range.deco.range(range.from, range.to)), true)
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    /**
     * Atomic, or the cursor walks INTO a hidden block.
     *
     * A replaced block still occupies document positions. Without this, arrowing
     * up out of the body put the caret inside the hidden frontmatter or a hidden
     * code fence - which renders as nothing, so it looked like the cursor had
     * jumped to an empty row and then refused to move line by line. Atomic
     * ranges make the whole block one step.
     */
    EditorView.atomicRanges.from(field, (value) => () => value),
  ],
})

export const setLivePreview = StateEffect.define<boolean>()

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
        // The `- ` goes too. A checkbox already reads as a list item, so the
        // dash beside it is a second bullet for the same thing - and it left a
        // gap to the left of every box.
        const indent = task[1].length - task[1].trimStart().length
        ranges.push({ from: line.from + indent, to: boxFrom, deco: hidden })
        ranges.push({
          from: boxFrom,
          to: boxFrom + task[2].length,
          deco: Decoration.replace({
            widget: new TaskBox(task[2] !== '[ ]', boxFrom),
          }),
        })
      }

      // `==highlight==` is not in the markdown grammar, so the markers have to
      // be hidden here by hand. The highlight itself is painted in blocks.ts,
      // which runs in Source mode too.
      // Images before wikilinks: `![alt](x)` contains no [[ ]], but matching
      // it first keeps the overlap rule from dropping it.
      for (const match of line.text.matchAll(IMAGE)) {
        const start = line.from + (match.index ?? 0)
        ranges.push({
          from: start,
          to: start + match[0].length,
          deco: Decoration.replace({ widget: new ImageWidget(match[2] ?? '', match[1] ?? '') }),
        })
      }

      for (const match of line.text.matchAll(HIGHLIGHT)) {
        const start = line.from + (match.index ?? 0)
        const end = start + match[0].length
        ranges.push({ from: start, to: start + 2, deco: hidden })
        ranges.push({ from: end - 2, to: end, deco: hidden })
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

  /**
   * Sorted, non-overlapping - and at the same start position, the LONGER range
   * wins.
   *
   * These are replacements, so the outermost one is the one that means
   * something. An image is the case that exposed it: the grammar contributes a
   * `LinkMark` covering the `![` at offset 0, and with shortest-first that
   * two-character marker was added before the widget covering the whole
   * `![alt](src)` - which was then dropped as overlapping, so images silently
   * never rendered.
   */
  ranges.sort((a, b) => a.from - b.from || b.to - a.to)
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
    blockHiding,
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
