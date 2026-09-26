/**
 * Folding headings and list items: what a fold covers, folding and unfolding,
 * remembering folds, and the toggles in the gutter.
 */

import type { SyntaxNode, Tree } from '@lezer/common'
import { type EditorState, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree, ensureSyntaxTree, foldedRanges, unfoldEffect, foldEffect } from '@codemirror/language'
import { type EditorView, WidgetType, Decoration, type DecorationSet, type ViewUpdate, ViewPlugin } from '@codemirror/view'

type FoldRange = { from: number; to: number }

const HEADING = /^ATXHeading(\d)$/

const headingLevel = (node: SyntaxNode): number | null => {
  const match = HEADING.exec(node.name)
  return match === null ? null : Number(match[1])
}

/**
 * Pull a range's end back past trailing blank lines.
 *
 * A section runs until the next heading, and the blank line before that heading
 * belongs visually to the gap, not to the section - folding it too glued the
 * next heading onto the folded one.
 */
export function trimEnd(state: EditorState, from: number, to: number): number {
  let line = state.doc.lineAt(to)
  while (line.from > from && line.text.trim() === '') line = state.doc.lineAt(line.from - 1)
  return Math.max(from, line.to)
}

/** The heading that starts on this line, if any, as a top-level node. */
function headingOn(tree: Tree, lineFrom: number): SyntaxNode | null {
  const top = tree.topNode
  let node = top.childAfter(lineFrom)
  // childAfter returns the first child ending after the position, which may
  // start on an earlier line (a paragraph running into this one).
  while (node !== null && node.from < lineFrom) node = node.nextSibling
  if (node === null || node.from !== lineFrom || headingLevel(node) === null) return null
  return node
}

/** The list item whose marker is on this line, if any. */
function listItemOn(state: EditorState, tree: Tree, lineFrom: number, lineTo: number): SyntaxNode | null {
  const text = state.doc.sliceString(lineFrom, lineTo)
  const lead = /^[\s>]*/.exec(text)?.[0].length ?? 0
  if (lineFrom + lead >= lineTo) return null
  for (let node: SyntaxNode | null = tree.resolveInner(lineFrom + lead, 1); node; node = node.parent) {
    if (node.name === 'ListItem') return node.from >= lineFrom && node.from <= lineTo ? node : null
  }
  return null
}

/**
 * What folding this line would hide, or null if there is nothing under it.
 *
 * Starts at the END of the line, so the heading or the item itself stays
 * visible with its fold marker after it.
 */
export function foldRangeAt(state: EditorState, lineNumber: number, tree: Tree = syntaxTree(state)): FoldRange | null {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null
  const line = state.doc.line(lineNumber)

  const heading = headingOn(tree, line.from)
  if (heading !== null) {
    const level = headingLevel(heading) ?? 6
    let end = state.doc.length
    for (let next = heading.nextSibling; next !== null; next = next.nextSibling) {
      const nextLevel = headingLevel(next)
      if (nextLevel !== null && nextLevel <= level) {
        end = Math.max(line.to, next.from - 1)
        break
      }
    }
    const to = trimEnd(state, line.to, end)
    return to > line.to ? { from: line.to, to } : null
  }

  const item = listItemOn(state, tree, line.from, line.to)
  if (item !== null) {
    const to = trimEnd(state, line.to, item.to)
    return to > line.to ? { from: line.to, to } : null
  }

  return null
}

/**
 * The tree for the whole note, parsing the rest if it has to.
 *
 * The editor parses lazily, around what is on screen. Folding everything, or
 * restoring folds as a long note opens, needs headings far below the viewport -
 * which an unparsed tree does not have yet, so those folds silently did nothing.
 */
const whole = (state: EditorState): Tree => ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state)

/** The fold currently hiding what is under this line, if there is one. */
function foldedAt(state: EditorState, lineNumber: number): FoldRange | null {
  const line = state.doc.line(lineNumber)
  let found: FoldRange | null = null
  foldedRanges(state).between(line.to, line.to, (from, to) => {
    if (from === line.to) found = { from, to }
  })
  return found
}

/** Fold or unfold the structure under one line. False if it has none. */
export function toggleFoldAt(view: EditorView, lineNumber: number): boolean {
  const existing = foldedAt(view.state, lineNumber)
  if (existing !== null) {
    view.dispatch({ effects: unfoldEffect.of(existing) })
    return true
  }
  const range = foldRangeAt(view.state, lineNumber)
  if (range === null) return false
  // A caret inside the range would unfold it again on the very next update -
  // CodeMirror opens any fold the selection lands in - so it moves to the line
  // that stays visible.
  const head = view.state.selection.main.head
  const selection = head > range.from && head <= range.to ? { anchor: range.from } : undefined
  view.dispatch({ effects: foldEffect.of(range), ...(selection === undefined ? {} : { selection }) })
  return true
}

/**
 * Fold every heading and every list item that has something under it.
 *
 * Outer structure only would leave nothing to see after unfolding one heading;
 * folding everything means opening a section shows its own sub-headings
 * folded, which is how an outline is read.
 */
export function foldAll(view: EditorView): void {
  const effects = []
  const head = view.state.selection.main.head
  /** The outermost fold the caret would end up inside, which must not open again. */
  let outer: FoldRange | null = null
  const tree = whole(view.state)
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const range = foldRangeAt(view.state, n, tree)
    if (range === null || foldedAt(view.state, n) !== null) continue
    effects.push(foldEffect.of(range))
    if (head > range.from && head <= range.to && (outer === null || range.from < outer.from)) outer = range
  }
  if (effects.length === 0) return
  view.dispatch({ effects, ...(outer === null ? {} : { selection: { anchor: outer.from } }) })
}

export function unfoldAll(view: EditorView): void {
  const effects: ReturnType<typeof unfoldEffect.of>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }))
  })
  if (effects.length > 0) view.dispatch({ effects })
}

/**
 * Folded lines, by line number - the form folds are remembered in.
 *
 * Line numbers rather than offsets because they are what a person would say
 * ("the section at line 12") and survive an edit elsewhere on the same line.
 * A remembered fold whose line no longer folds anything is simply dropped.
 */
export function foldedLines(state: EditorState): number[] {
  const lines: number[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines
}

export function restoreFolds(view: EditorView, lines: readonly number[]): void {
  const effects = []
  const tree = whole(view.state)
  for (const n of lines) {
    const range = foldRangeAt(view.state, n, tree)
    if (range !== null) effects.push(foldEffect.of(range))
  }
  if (effects.length > 0) view.dispatch({ effects })
}

class FoldToggle extends WidgetType {
  constructor(
    private readonly folded: boolean,
    /** `h1`…`h6` for a heading, `li` for a list item - sets the size. */
    private readonly kind: string,
  ) {
    super()
  }

  override eq(other: FoldToggle): boolean {
    return other.folded === this.folded && other.kind === this.kind
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('span')
    button.className = `cm-fold-toggle cm-fold-toggle--${this.kind}${this.folded ? ' is-folded' : ''}`
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', this.folded ? 'Unfold' : 'Fold')
    button.setAttribute('aria-expanded', String(!this.folded))
    // A chevron drawn in CSS: one element, no icon font, and it rotates.
    button.appendChild(document.createElement('span'))
    button.addEventListener('mousedown', (event) => {
      // mousedown, and prevented: a click would first move the caret into the
      // line - and a caret inside a fold is exactly what opens it again.
      event.preventDefault()
      event.stopPropagation()
      const pos = view.posAtDOM(button)
      toggleFoldAt(view, view.state.doc.lineAt(pos).number)
    })
    return button
  }

  override ignoreEvent(): boolean {
    return true
  }
}

const toggles = new Map<string, Decoration>()

function toggle(folded: boolean, kind: string): Decoration {
  const key = `${kind}:${folded}`
  let deco = toggles.get(key)
  if (deco === undefined) {
    deco = Decoration.widget({ widget: new FoldToggle(folded, kind), side: -1 })
    toggles.set(key, deco)
  }
  return deco
}

function buildToggles(view: EditorView): DecorationSet {
  const { state } = view
  const found: { pos: number; deco: Decoration }[] = []
  const seen = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (name === 'FencedCode' || name === 'MathBlock' || name === 'Table' || name === 'FrontMatter') return false
        const level = HEADING.exec(name)
        if (level === null && name !== 'ListItem') return undefined
        const line = state.doc.lineAt(node.from)
        if (seen.has(line.number)) return undefined
        seen.add(line.number)
        if (foldRangeAt(state, line.number) === null) return undefined
        const folded = foldedAt(state, line.number) !== null
        found.push({ pos: node.from, deco: toggle(folded, level === null ? 'li' : `h${level[1]}`) })
        return undefined
      },
    })
  }

  found.sort((a, b) => a.pos - b.pos)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { pos, deco } of found) builder.add(pos, pos, deco)
  return builder.finish()
}

export const foldsChanged = (update: ViewUpdate): boolean => foldedRanges(update.startState) !== foldedRanges(update.state)

export const toggleLayer = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildToggles(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldsChanged(update) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildToggles(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
