import { syntaxTree } from '@codemirror/language'
import { writingConfig } from './writing'
import { Compartment, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { vaultFileUrl } from '../core/vault-url'
import {
  CalloutHeader,
  EmbedWidget,
  FootnoteWidget,
  MathWidget,
  mathSource,
  stripContainers,
  TableWidget,
} from './rich-widgets'
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
  // `%%` around a comment: the comment itself stays, dimmed, the way Obsidian's
  // Live Preview shows it.
  'CommentMark',
])

const hidden = Decoration.replace({})

/**
 * The visible half of `[text](target)`.
 *
 * Live Preview already hides the brackets and the URL, so what is left reads
 * as a link and behaved like plain prose: nothing to click. The target rides
 * along as an attribute, so the click handler does not have to re-parse the
 * line to find out where it goes.
 */
const mdLink = (href: string): Decoration =>
  Decoration.mark({ class: 'cm-mdlink', attributes: { 'data-href': href } })

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

const bullet = Decoration.replace({ widget: new BulletWidget() })

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g
const EMBED = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
/** `> [!type]` with an optional fold sign and title. */
export const CALLOUT_HEAD = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)(.*)$/
const HIGHLIGHT = /==([^=\n]+)==/g
const TASK = /^(\s*[-*+]\s+)(\[[ xX]\])/
/**
 * `[text](a path with spaces.md)`.
 *
 * CommonMark says a destination with a space in it must be escaped or wrapped
 * in `<>`, so the grammar does not see this as a link at all - but it is what
 * people type, and Obsidian follows it. Handled here, the way wikilinks and
 * tasks are, and only for the spaced case: anything the grammar does recognise
 * is left to it.
 */
const LOOSE_LINK = /(?<!!)\[([^\]\n]+)\]\(([^)\n]*\s[^)\n]*)\)/g
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
const FENCE = /^\s*(`{3,}|~{3,})/

const hiddenBlock = Decoration.replace({ block: true })
/**
 * A horizontal rule, drawn ON its line rather than instead of it.
 *
 * It used to be a block widget replacing the whole line, which left the line
 * with no place to put a cursor: arrowing down the note jumped straight over
 * it, and a rule you cannot reach is a rule you cannot delete. The line stays a
 * line - the `---` is hidden inline, the rule is drawn across the row in CSS -
 * so the caret lands there like anywhere else and the markers come back, the
 * way every other piece of syntax in Live Preview behaves.
 */
const ruleLine = Decoration.line({ class: 'cm-rule-line' })
const ruleMarks = Decoration.replace({})

const blockHiding = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    // The syntax tree finishes parsing a long note in the background, after the
    // transaction that opened it; a table or formula further down only appears
    // in the tree later. Recompute when the tree changes too, or those stay raw
    // until something else happens to move the caret.
    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    if (!transaction.docChanged && transaction.selection === undefined && !treeChanged && value !== Decoration.none) {
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
    }

    // --- rules, maths blocks and tables, from the grammar -----------------
    //
    // Rules used to be guessed from the text: a `---` line counted unless the
    // line above had text, to avoid eating a setext heading. That guessed wrong
    // both ways - a `---` right after a list item stayed raw, and a `---` under
    // a `$$` block the grammar did not understand became a heading. The parser
    // knows which one it is, so it decides.
    syntaxTree(state).iterate({
      enter: (node) => {
        const name = node.name
        if (name !== 'HorizontalRule' && name !== 'MathBlock' && name !== 'Table') return undefined
        const first = doc.lineAt(node.from)
        const last = doc.lineAt(node.to)
        if (first.number <= frontmatterEnd) return false
        for (let n = first.number; n <= last.number; n++) if (touched.has(n)) return false

        if (name === 'HorizontalRule') {
          ranges.push({ from: first.from, to: first.from, deco: ruleLine })
          if (last.to > first.from) ranges.push({ from: first.from, to: last.to, deco: ruleMarks })
        } else if (name === 'MathBlock') {
          const tex = mathSource(doc.sliceString(node.from, node.to))
          ranges.push({
            from: first.from,
            to: last.to,
            deco: Decoration.replace({ block: true, widget: new MathWidget(tex, true, true) }),
          })
        } else {
          ranges.push({
            from: first.from,
            to: last.to,
            deco: Decoration.replace({
              block: true,
              widget: new TableWidget(stripContainers(doc.sliceString(first.from, last.to))),
            }),
          })
        }
        return false
      },
    })

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
  const focus = view.state.field(writingConfig, false)?.focus ?? false
  const head = view.state.selection.main.head
  type Range = { from: number; to: number; deco: Decoration }
  const ranges: Range[] = []

  for (const { from, to } of view.visibleRanges) {
    // --- syntax markers, from the grammar --------------------------------
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        // Blocks the block field renders whole: nothing inside them should be
        // decorated separately.
        if (node.name === 'MathBlock' || node.name === 'Table' || node.name === 'FencedCode') return false

        if (node.name === 'InlineMath' || node.name === 'FootnoteRef') {
          /*
           * In focus mode the cursor has to be INSIDE the formula, not merely
           * on its line, before the `$...$` comes back.
           *
           * Focus mode moves the cursor down the note a line at a time, and
           * with the ordinary line rule every line it landed on turned its
           * maths into source: the one line you are meant to be reading was
           * the one written in LaTeX. Standing in the formula is still how you
           * edit it.
           */
          const reveal = focus
            ? head >= node.from && head <= node.to
            : active.has(view.state.doc.lineAt(node.from).number)
          if (reveal) return false
          const text = view.state.doc.sliceString(node.from, node.to)
          if (node.name === 'InlineMath') {
            const display = text.startsWith('$$')
            const tex = text.slice(display ? 2 : 1, text.length - (display ? 2 : 1))
            ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new MathWidget(tex, display, false) }) })
          } else {
            ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new FootnoteWidget(text.slice(2, -1)) }) })
          }
          return false
        }

        if (node.name === 'ListMark') {
          if (active.has(view.state.doc.lineAt(node.from).number)) return
          // Only unordered lists. `1.` is content - renumbering it as a dot
          // would lose the one thing an ordered list is for.
          if (!/^[-*+]$/.test(view.state.doc.sliceString(node.from, node.to))) return
          // The space after the marker goes too, so the dot's box stands for
          // exactly `- ` and the item's hanging indent has one width to match
          // rather than a dot plus a stray space that only shows on the first
          // row.
          const after = view.state.doc.sliceString(node.to, node.to + 1)
          ranges.push({ from: node.from, to: after === ' ' ? node.to + 1 : node.to, deco: bullet })
          return
        }
        if (node.name === 'Link' && !active.has(view.state.doc.lineAt(node.from).number)) {
          // `[text](target)`: mark the text, and keep walking so the brackets
          // and the URL are hidden by the marker rule below.
          const whole = view.state.doc.sliceString(node.from, node.to)
          const close = whole.indexOf('](')
          const end = whole.lastIndexOf(')')
          // A label with its own markup - `[**bold**](x)` - keeps the emphasis
          // hiding it would otherwise swallow: this mark spans the whole label,
          // and the builder drops anything that falls inside it. Such a link is
          // still clickable; the handler finds it in the syntax tree instead.
          const plainLabel = !/[*_`~=[\]]/.test(whole.slice(1, close))
          if (close > 1 && end > close && plainLabel) {
            ranges.push({
              from: node.from + 1,
              to: node.from + close,
              deco: mdLink(whole.slice(close + 2, end).trim()),
            })
          }
        }
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

      for (const match of line.text.matchAll(LOOSE_LINK)) {
        const start = line.from + (match.index ?? 0)
        const label = match[1] ?? ''
        const href = (match[2] ?? '').trim()
        if (href === '') continue
        ranges.push({ from: start, to: start + 1, deco: hidden })
        ranges.push({ from: start + 1, to: start + 1 + label.length, deco: mdLink(href) })
        ranges.push({ from: start + 1 + label.length, to: start + match[0].length, deco: hidden })
      }

      // Obsidian's embed, `![[file]]` or `![[file|300]]`. Before the wikilink
      // pass: it contains a wikilink, and the longer range has to win.
      for (const match of line.text.matchAll(EMBED)) {
        const start = line.from + (match.index ?? 0)
        ranges.push({
          from: start,
          to: start + match[0].length,
          deco: Decoration.replace({ widget: new EmbedWidget(match[1]?.trim() ?? '', match[2]?.trim() ?? null) }),
        })
      }

      // A callout's first line: `> [!note] Title` becomes an icon and a title.
      // The colour for the whole callout comes from blocks.ts, in both modes.
      const callout = CALLOUT_HEAD.exec(line.text)
      if (callout !== null) {
        const start = line.from + (callout[1]?.length ?? 0)
        ranges.push({
          from: start,
          to: line.to,
          deco: Decoration.replace({ widget: new CalloutHeader(callout[2] ?? 'note', (callout[4] ?? '').trim()) }),
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
    // A replacement that crosses a line break is refused by CodeMirror when it
    // comes from a plugin - and it throws while the editor is being built,
    // which took the whole window down to a blank frame. The grammar can
    // produce one: inline maths, say, runs across lines inside one paragraph.
    // Such a range is left as source.
    if (range.to > view.state.doc.lineAt(range.from).to) continue
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
    // The mode as a class, so CSS can tell the two apart - the active-line tint
    // belongs to Source mode only.
    EditorView.editorAttributes.compute([livePreviewEnabled], (state) => ({
      class: state.field(livePreviewEnabled) ? 'cm-live' : 'cm-source',
    })),
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
