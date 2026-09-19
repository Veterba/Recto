import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { DEFAULT_WRITING, type WritingSettings } from '../core/writing'
import { authorField } from './authorship'
import { focusRange } from './focus-range'
import { findStyleIssues, STYLE_LABELS, type StyleKind } from './style-check'
import { tagText, type PartOfSpeech } from './syntax-tags'

/**
 * iA Writer's writing tools in the editor: focus mode with typewriter
 * scrolling, syntax highlight, style check and authorship colours.
 *
 * Everything is a decoration over the text - nothing here ever changes the
 * note. Settings arrive as an effect, so switching a tool on repaints at once
 * without rebuilding the editor.
 */

export const setWritingConfig = StateEffect.define<WritingSettings>()

export const writingConfig = StateField.define<WritingSettings>({
  create: () => DEFAULT_WRITING,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setWritingConfig)) return effect.value
    return value
  },
})

/** Whether the line being written is held in the middle of the window. */
const centring = (config: WritingSettings): boolean => config.focus || config.typewriter

// --- what not to analyse ---------------------------------------------------------

/** Syntax nodes whose text is not prose: code, maths, links' addresses, raw HTML. */
const NOT_PROSE = new Set([
  'FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'URL', 'LinkLabel', 'HTMLBlock', 'HTMLTag', 'Comment',
  'CommentBlock', 'MathBlock', 'InlineMath', 'Autolink',
])

/**
 * A paragraph's text with everything that is not prose blanked out, same
 * length, so offsets still line up. Tagging `const x = 1` as nouns and verbs,
 * or striking "just" through inside a URL, would be noise.
 */
function prose(state: EditorState, from: number, to: number): string {
  const chars = state.doc.sliceString(from, to).split('')
  const blank = (a: number, b: number): void => {
    for (let i = Math.max(a, from); i < Math.min(b, to); i++) {
      if (chars[i - from] !== '\n') chars[i - from] = ' '
    }
  }
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (NOT_PROSE.has(node.name)) {
        blank(node.from, node.to)
        return false
      }
      return undefined
    },
  })
  const text = chars.join('')
  // Wikilinks and embeds name files, not words.
  for (const match of text.matchAll(/!?\[\[[^\]]*\]\]/g)) blank(from + (match.index ?? 0), from + (match.index ?? 0) + match[0].length)
  return chars.join('')
}

/** Where the frontmatter ends, or 0. */
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc
  if (doc.lines < 2 || !/^---\s*$/.test(doc.line(1).text)) return 0
  for (let n = 2; n <= Math.min(doc.lines, 400); n++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.line(n).text)) return doc.line(n).to
  }
  return 0
}

// --- decorations -----------------------------------------------------------------

const POS_ON: Record<PartOfSpeech, keyof WritingSettings['syntax']> = {
  adjective: 'adjectives',
  noun: 'nouns',
  adverb: 'adverbs',
  verb: 'verbs',
  conjunction: 'conjunctions',
}
const posMark = Object.fromEntries(
  (Object.keys(POS_ON) as PartOfSpeech[]).map((pos) => [pos, Decoration.mark({ class: `cm-pos cm-pos-${pos}` })]),
) as Record<PartOfSpeech, Decoration>

const styleMark = Object.fromEntries(
  (Object.keys(STYLE_LABELS) as StyleKind[]).map((kind) => [
    kind,
    Decoration.mark({ class: `cm-style cm-style-${kind}`, attributes: { title: STYLE_LABELS[kind] } }),
  ]),
) as Record<StyleKind, Decoration>

const authorMark = {
  ai: Decoration.mark({ class: 'cm-author cm-author-ai', attributes: { title: 'Written by AI' } }),
  reference: Decoration.mark({ class: 'cm-author cm-author-reference', attributes: { title: 'Reference' } }),
}

const dimLine = Decoration.line({ class: 'cm-focus-dim' })
const dimText = Decoration.mark({ class: 'cm-focus-dim' })
const litLine = Decoration.line({ class: 'cm-focus-lit' })

function build(view: EditorView): DecorationSet {
  const { state } = view
  const config = state.field(writingConfig)
  const decorations: Range<Decoration>[] = []
  const skip = frontmatterEnd(state)

  const wantSyntax = config.syntax.on
  const wantStyle = config.style.on

  for (const visible of view.visibleRanges) {
    // --- syntax and style, a paragraph at a time -----------------------------
    if (wantSyntax || wantStyle) {
      let line = state.doc.lineAt(Math.max(visible.from, skip))
      while (line.from <= visible.to) {
        if (line.text.trim() === '' || line.to <= skip) {
          if (line.number >= state.doc.lines) break
          line = state.doc.line(line.number + 1)
          continue
        }
        // Extend to the whole paragraph, so a sentence is always tagged in one piece.
        let first = line
        while (first.number > 1 && state.doc.line(first.number - 1).text.trim() !== '' && state.doc.line(first.number - 1).from > skip) {
          first = state.doc.line(first.number - 1)
        }
        let last = line
        while (last.number < state.doc.lines && state.doc.line(last.number + 1).text.trim() !== '') {
          last = state.doc.line(last.number + 1)
        }
        const from = first.from
        const text = prose(state, from, last.to)
        if (wantSyntax) {
          for (const tag of tagText(text)) {
            if (config.syntax[POS_ON[tag.pos]]) decorations.push(posMark[tag.pos].range(from + tag.from, from + tag.to))
          }
        }
        if (wantStyle) {
          for (const issue of findStyleIssues(text, config.style)) {
            decorations.push(styleMark[issue.kind].range(from + issue.from, from + issue.to))
          }
        }
        if (last.number >= state.doc.lines) break
        line = state.doc.line(last.number + 1)
      }
    }
  }

  // --- authors -----------------------------------------------------------------
  if (config.authors.on) {
    for (const range of state.field(authorField, false) ?? []) {
      if (!config.authors[range.author]) continue
      decorations.push(authorMark[range.author].range(range.from, range.to))
    }
  }

  // --- focus -------------------------------------------------------------------
  if (config.focus) {
    const head = state.selection.main.head
    const lit = focusRange(state.doc, head, config.focusUnit)
    for (const visible of view.visibleRanges) {
      for (let n = state.doc.lineAt(visible.from).number; n <= state.doc.lineAt(visible.to).number; n++) {
        const line = state.doc.line(n)
        if (line.to < lit.from || line.from > lit.to) {
          decorations.push(dimLine.range(line.from))
          continue
        }
        decorations.push(litLine.range(line.from))
        // Part of this line is outside the sentence: dim just that part.
        if (line.from < lit.from) decorations.push(dimText.range(line.from, lit.from))
        if (line.to > lit.to) decorations.push(dimText.range(lit.to, line.to))
      }
    }
  }

  return Decoration.set(decorations, true)
}

const decorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate): void {
      const configChanged = update.startState.field(writingConfig) !== update.state.field(writingConfig)
      const config = update.state.field(writingConfig)
      if (
        update.docChanged ||
        update.viewportChanged ||
        configChanged ||
        (update.selectionSet && config.focus) ||
        update.startState.field(authorField, false) !== update.state.field(authorField, false) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

// --- typewriter scrolling ----------------------------------------------------------

const GLIDE_MS = 170

/**
 * Keep the caret's line in the middle of the window.
 *
 * A glide rather than a jump: the text slides up as you finish a line, the
 * way paper moves in a typewriter, and a new keystroke mid-glide retargets
 * from wherever the scroll is. Clicking with the mouse does not recentre - the
 * text would move out from under the pointer - but the next keystroke does.
 */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    frame = 0
    pending = false

    constructor(readonly view: EditorView) {
      if (centring(view.state.field(writingConfig))) this.schedule(false)
    }

    update(update: ViewUpdate): void {
      const config = update.state.field(writingConfig)
      if (!centring(config)) return
      const toggled = !centring(update.startState.field(writingConfig))
      const pointer = update.transactions.some((tr) => tr.isUserEvent('select.pointer'))
      /*
       * Typing and moving the caret recentre. Scrolling does NOT.
       *
       * `geometryChanged` used to be in here, to recentre after a resize - but
       * it also fires as new lines are measured during a scroll, so scrolling
       * down a note with focus mode on pulled the view straight back to the
       * caret: the note appeared to scroll itself up. Reading around the line
       * you are writing is a thing people do, and the next keystroke recentres
       * anyway.
       */
      if (toggled || update.docChanged || (update.selectionSet && !pointer)) {
        this.schedule(!toggled)
      }
    }

    schedule(smooth: boolean): void {
      if (this.pending) return
      this.pending = true
      this.view.requestMeasure({
        read: (view) => {
          this.pending = false
          const head = view.state.selection.main.head
          const caret = view.coordsAtPos(head)
          if (caret === null) return null
          const box = view.scrollDOM.getBoundingClientRect()
          return (caret.top + caret.bottom) / 2 - (box.top + box.height / 2)
        },
        write: (delta, view) => {
          if (delta === null || Math.abs(delta) < 2) return
          this.glide(view.scrollDOM, delta, smooth)
        },
      })
    }

    glide(scroller: HTMLElement, delta: number, smooth: boolean): void {
      cancelAnimationFrame(this.frame)
      const start = scroller.scrollTop
      const target = start + delta
      if (!smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        scroller.scrollTop = target
        return
      }
      const began = performance.now()
      const step = (now: number): void => {
        const t = Math.min(1, (now - began) / GLIDE_MS)
        const eased = 1 - Math.pow(1 - t, 3)
        scroller.scrollTop = start + (target - start) * eased
        if (t < 1) this.frame = requestAnimationFrame(step)
      }
      this.frame = requestAnimationFrame(step)
    }

    destroy(): void {
      cancelAnimationFrame(this.frame)
    }
  },
)

export function writingTools(): Extension {
  return [
    writingConfig,
    authorField,
    decorationsPlugin,
    typewriterPlugin,
    EditorView.editorAttributes.compute([writingConfig], (state) => {
      const c = state.field(writingConfig)
      const classes = [
        c.focus ? 'cm-writing-focus' : '',
        centring(c) ? 'cm-typewriter' : '',
        c.syntax.on ? 'cm-writing-syntax' : '',
        c.style.on ? 'cm-writing-style' : '',
      ].filter(Boolean)
      // Focus mode brings its own text size; outside it the editor's own stands.
      const size = c.focus ? `; --editor-font-size: ${c.fontSize}px` : ''
      return { class: classes.join(' '), style: `--focus-dim: ${c.dim}${size}` }
    }),
    EditorView.contentAttributes.compute([writingConfig], (state) => ({
      spellcheck: state.field(writingConfig).spellcheck ? 'true' : 'false',
    })),
  ]
}
