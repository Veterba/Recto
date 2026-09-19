import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import * as md from './markdown-actions'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { foldedRanges, indentOnInput, syntaxTree } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { activeFormats, type Format } from './markdown-actions'
import { blockDecorations } from './blocks'
import { imageDrop } from './images'
import { noSetextHeadings, obsidianSyntax } from './obsidian-syntax'
import { foldAll, foldedLines, noteStructure, restoreFolds, toggleFoldAt, unfoldAll } from './structure'
import { authorAnnotation, authorField, fromStored, setAuthorRanges, toStored, type Author, type StoredRange } from './authorship'
import { setWritingConfig, writingTools } from './writing'
import type { WritingSettings } from '../core/writing'
import { markdownDecorations, setUnresolvedTargets, unresolvedField } from './decorations'
import { livePreview, livePreviewCompartment, setLivePreview } from './live-preview'
import { linkCompletion, type LinkCandidate } from './link-complete'
import { editorTheme, markdownHighlighting } from './theme'

/**
 * The CodeMirror wrapper.
 *
 * This module is the ONLY place in the app that imports CodeMirror. Everything
 * outside it sees the `EditorHandle` below - plain strings and callbacks. That
 * is deliberate: Obsidian's public API re-exports CM types and is consequently
 * frozen on a beta version of it forever.
 *
 * React mounts the container and never touches inside it; CodeMirror owns that
 * DOM entirely.
 */

export type EditorHandle = {
  /** Current document text. */
  getValue: () => string
  /**
   * Replace the document without destroying history or losing the cursor.
   * Used when a note is changed by another app.
   */
  setValue: (next: string) => void
  /** Run one of the markdown actions against the live state. */
  run: (action: (state: EditorState) => TransactionSpec | null) => boolean
  /** Mark these link targets as pointing at nothing, so they render as broken. */
  setUnresolved: (targets: readonly string[]) => void
  /** Scroll to a heading by its text. False if the note has no such heading. */
  revealHeading: (heading: string) => boolean
  /** Live Preview hides markdown markers away from the cursor. */
  setLivePreview: (on: boolean) => void
  /** Modal editing, toggled without rebuilding the editor. */
  setVim: (on: boolean) => void
  /**
   * Write now, rather than waiting for the debounce.
   *
   * Saving is automatic, so this exists for the habit: ⌘S is what people press
   * when they want to be sure, and a text editor where it does nothing feels
   * like one that is not saving.
   */
  save: () => void
  /** Focus mode, syntax, style and authorship settings, pushed live. */
  setWriting: (settings: WritingSettings) => void
  /** Load a note's saved authorship. */
  setAuthors: (stored: readonly StoredRange[]) => void
  getAuthors: () => StoredRange[]
  /** Insert text at the selection, marked as written by this author. */
  insertAs: (author: Author | 'human', text: string) => void
  /** Re-mark the selected text as this author's. */
  markSelection: (author: Author | 'human') => boolean
  /** Put the caret at the start of a line and centre it, opening any fold over it. */
  revealLine: (line: number) => void
  /** The caret's line, 1-based. */
  getCursorLine: () => number
  /** Fold or unfold the heading or list item under the caret. */
  toggleFold: () => boolean
  foldAll: () => void
  unfoldAll: () => void
  /** Folded lines by number, to remember a note's folds between visits. */
  getFolds: () => number[]
  setFolds: (lines: readonly number[]) => void
  /** Formats applying at the cursor, for the toolbar's pressed state. */
  getActiveFormats: () => ReadonlySet<Format>
  focus: () => void
  undo: () => void
  redo: () => void
  openSearch: () => void
  destroy: () => void
}

export type EditorOptions = {
  doc: string
  onChange: (value: string) => void
  /** Cmd+S. Autosave already runs, so this is a "flush now" affordance. */
  onSave: () => void
  /** Called when a wikilink is clicked, with the target and any `#heading`. */
  onOpenLink: (target: string, heading: string | null) => void
  readOnly?: boolean
  /** Note names offered after typing `[[`. Read lazily, so it stays current. */
  getLinkCandidates?: () => readonly LinkCandidate[]
  /** Fires when the cursor moves, so the toolbar can update. */
  onSelectionChange?: () => void
  vim?: boolean
  /** Fires when a section or list item is folded or unfolded. */
  onFoldsChange?: (lines: number[]) => void
  /** Fires when authorship changes - text marked, or a marked passage edited. */
  onAuthorsChange?: () => void
}

const editable = new Compartment()
/**
 * Vim lives in a compartment so the setting can be flipped without rebuilding
 * the editor - which would lose the cursor, the scroll position and the undo
 * history every time someone tried it out.
 */
const vimMode = new Compartment()

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  /** Where a `[text](target)` link goes, given a position inside its label. */
  const markdownHrefAt = (view: EditorView, pos: number): string | null => {
    let node = syntaxTree(view.state).resolveInner(pos, 1)
    while (node.parent !== null && node.name !== 'Link') node = node.parent
    if (node.name !== 'Link') return null
    // The label only: a click in the URL half is someone editing it.
    const whole = view.state.doc.sliceString(node.from, node.to)
    const close = whole.indexOf('](')
    if (close < 0 || pos > node.from + close) return null
    const end = whole.lastIndexOf(')')
    return end > close ? whole.slice(close + 2, end).trim() : null
  }

  /**
   * Clicking a link follows it; clicking elsewhere is a normal click.
   *
   * Both spellings work. `[[wikilinks]]` carry their target as their own text;
   * `[text](target)` hides the target in Live Preview, so the decoration puts
   * it in `data-href` - and when the label is too complicated to decorate, the
   * syntax tree still knows where the link goes. An `http(s)` target leaves for
   * the browser through the window-open handler, which is the one path in the
   * app allowed to open anything outside it.
   */
  const linkClick = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      if (target?.classList.contains('cm-wikilink') === true) {
        // The decoration spans the whole inside of the brackets, so the
        // element's own text is the link - no need to re-scan the line.
        const inner = target.textContent ?? ''
        const parsed = /^([^#|]+)(?:#([^|]+))?/.exec(inner.trim())
        const name = parsed?.[1]?.trim()
        if (name === undefined || name === '') return false
        event.preventDefault()
        options.onOpenLink(name, parsed?.[2]?.trim() ?? null)
        return true
      }

      const marked = target?.closest('.cm-mdlink')?.getAttribute('data-href') ?? null
      let href = marked
      if (href === null) {
        // No decoration here: either the label carries its own markup, or the
        // line is showing raw syntax because the cursor is on it. The second is
        // editing, not following, so only a rendered line navigates.
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        const line = view.state.doc.lineAt(pos).number
        const caret = view.state.doc.lineAt(view.state.selection.main.head).number
        if (line === caret) return false
        href = markdownHrefAt(view, pos)
      }
      if (href === null || href === '') return false

      event.preventDefault()
      if (/^https?:\/\//i.test(href)) {
        // Denied as a window by the main process, which hands it to the OS.
        window.open(href, '_blank', 'noopener,noreferrer')
        return true
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true
      const hash = href.indexOf('#')
      const path = (hash === -1 ? href : href.slice(0, hash)).trim()
      const heading = hash === -1 ? null : href.slice(hash + 1).trim()
      if (path === '') return true
      let decoded = path
      try {
        decoded = decodeURIComponent(path)
      } catch {
        // A stray '%' is not an escape; take the path as written.
      }
      options.onOpenLink(decoded.replace(/\.md$/i, ''), heading === '' ? null : heading)
      return true
    },
  })

  /**
   * Open with the cursor at the start of the body, past any frontmatter.
   *
   * The cursor defaults to position 0, which is inside the frontmatter block -
   * so Live Preview's reveal rule would show raw YAML every time a note opened,
   * which is both ugly and not where anyone wants to start typing.
   */
  const bodyStart = ((): number => {
    const lines = options.doc.split('\n')
    if (!/^---\s*$/.test(lines[0] ?? '')) return 0
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i] ?? '')) {
        // Sum the lines consumed, plus their newlines.
        return lines.slice(0, i + 1).reduce((total, line) => total + line.length + 1, 0)
      }
    }
    return 0
  })()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      selection: { anchor: Math.min(bodyStart, options.doc.length) },
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        highlightActiveLine(),
        // `highlightSelectionMatches()` used to be here. Selecting a word lit up
        // every other occurrence of it - in CodeMirror's own default green,
        // because nothing in this app styles `.cm-selectionMatch`. Two
        // problems, and the second is the instructive one: an extension with
        // built-in styling will happily paint a colour that exists nowhere in
        // the palette. ⌘F highlighting is unaffected; that is `search()`.
        indentOnInput(),
        // Fold arrows beside headings and list items, and indentation guides.
        noteStructure(),
        // iA Writer's tools: focus, typewriter, syntax, style, authors.
        writingTools(),
        search({ top: true }),
        ...(options.getLinkCandidates === undefined ? [] : [linkCompletion(options.getLinkCandidates)]),
        EditorState.allowMultipleSelections.of(true),
        // Markdown with GFM-ish extensions; the grammar is CM's own, so
        // highlighting stays incremental as you type.
        // `languages` lazy-loads a grammar the first time a fence names it, so
        // a vault with no code costs nothing and ```python highlights properly.
        // This is what `codeLanguages: []` was a placeholder for.
        // Plus Obsidian's own syntax - maths, comments, footnotes - in the
        // grammar, so a note copied out of Obsidian parses the same here.
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true, extensions: [obsidianSyntax, noSetextHeadings] }),
        markdownHighlighting(),
        markdownDecorations(),
        blockDecorations(),
        // Live Preview sits in a compartment so the mode can be switched at
        // runtime without rebuilding the editor and losing undo history.
        livePreviewCompartment.of(
          livePreview((v) => v.state.field(unresolvedField, false) ?? new Set<string>()),
        ),
        editorTheme(),
        imageDrop(),
        linkClick,
        EditorView.lineWrapping,
        editable.of(EditorView.editable.of(options.readOnly !== true)),
        // Before the default keymap, or Vim's bindings lose every collision.
        vimMode.of(options.vim === true ? vim({ status: true }) : []),
        // App shortcuts are registered in the command registry and handled by
        // the window listener, so only editor-native bindings live here.
        keymap.of([
          ...searchKeymap,
          ...historyKeymap,
          // No `foldKeymap`: folding is app commands now (⌘. and ⌘⌥[ / ⌘⌥]),
          // and CodeMirror's own ⌘⌥[ folded by different rules - it would have
          // claimed the chord first and folded a section with its trailing
          // blank lines.
          // Tab, ours rather than CodeMirror's `indentWithTab`: inside a list
          // it moves the item a level, and anywhere else it is one plain unit.
          // The language's own answer next to a list was six spaces, which is
          // an indented code block, not an indent.
          {
            key: 'Tab',
            run: (view) => {
              const spec = md.indentListItems(view.state, 1)
              if (spec === null) return false
              view.dispatch(spec)
              return true
            },
            shift: (view) => {
              const spec = md.indentListItems(view.state, -1)
              if (spec === null) return false
              view.dispatch(spec)
              return true
            },
          },
          // From an indented blank line: ⇧Enter repeats the indent (the guides
          // stack into a column), Enter starts empty at the margin. Both leave
          // the line behind them as it was; everything else is the markdown
          // keymap's business, bullets and numbering included.
          ...[
            { key: 'Enter', carry: false },
            { key: 'Shift-Enter', carry: true },
          ].map(({ key, carry }) => ({
            key,
            run: (view: EditorView) => {
              const spec = md.newlineFromIndent(view.state, carry)
              if (spec === null) return false
              view.dispatch(spec)
              return true
            },
          })),
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString())
          // The toolbar needs to know on both, because typing can enter or
          // leave a format without the cursor being moved by hand.
          if (update.docChanged || update.selectionSet) options.onSelectionChange?.()
          if (update.startState.field(authorField, false) !== update.state.field(authorField, false)) {
            options.onAuthorsChange?.()
          }
          if (foldedRanges(update.startState) !== foldedRanges(update.state)) {
            options.onFoldsChange?.(foldedLines(update.state))
          }
        }),
      ],
    }),
  })

  return {
    getValue: () => view.state.doc.toString(),

    setValue: (next) => {
      const current = view.state.doc.toString()
      if (next === current) return
      /**
       * Replace only what differs, and carry the caret THROUGH the change.
       *
       * This used to swap the whole document and put the caret back at the
       * same numeric offset. Positions do not survive edits that way: adding
       * the first property to a note inserts a `---` block at offset 0, the
       * caret stayed at 0 - now inside the frontmatter - and Live Preview,
       * which shows raw syntax on the caret's line, put the YAML on screen.
       *
       * A minimal change (common prefix and suffix left alone) lets CodeMirror
       * map the selection itself, with text inserted at the caret landing
       * BEFORE it. It also keeps decorations and scroll steady, and makes the
       * edit one small undo step rather than a whole-document replacement.
       */
      let start = 0
      const limit = Math.min(current.length, next.length)
      while (start < limit && current.charCodeAt(start) === next.charCodeAt(start)) start++
      let end = 0
      while (
        end < limit - start &&
        current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)
      ) {
        end++
      }
      const changes = view.state.changes({
        from: start,
        to: current.length - end,
        insert: next.slice(start, next.length - end),
      })
      view.dispatch({ changes, selection: view.state.selection.map(changes, 1) })
    },

    run: (action) => {
      const spec = action(view.state)
      if (!spec) return false
      view.dispatch(spec)
      view.focus()
      return true
    },

    setUnresolved: (targets) => {
      view.dispatch({ effects: setUnresolvedTargets.of(targets) })
    },

      /**
     * Put the cursor on a heading and centre it.
     *
     * Matched on text rather than a stored position because the note may have
     * been edited since the link was written; a missing heading is a no-op
     * rather than a jump to the wrong place.
     */
    revealHeading: (heading) => {
      const wanted = heading.trim().toLowerCase()
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n)
        const match = /^#{1,6}\s+(.*)$/.exec(line.text)
        if (match?.[1]?.trim().toLowerCase() !== wanted) continue
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        })
        view.focus()
        return true
      }
      return false
    },

    revealLine: (n) => {
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines))
      // At the END of the line: a caret at the start of a heading shows its raw
      // `#` in Live Preview, and the end is where you would carry on writing.
      // Landing there also opens a fold that was hiding the line.
      view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 48 }) })
      view.focus()
    },
    getCursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    save: () => options.onSave(),
    setWriting: (settings) => {
      view.dispatch({ effects: setWritingConfig.of(settings) })
    },
    setAuthors: (stored) => {
      view.dispatch({ effects: setAuthorRanges.of(fromStored(view.state.doc, stored)) })
    },
    getAuthors: () => toStored(view.state.doc, view.state.field(authorField)),
    insertAs: (author, text) => {
      const range = view.state.selection.main
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length },
        annotations: authorAnnotation.of(author),
        scrollIntoView: true,
        userEvent: 'input.paste',
      })
      view.focus()
    },
    markSelection: (author) => {
      if (view.state.selection.ranges.every((range) => range.empty)) return false
      view.dispatch({ annotations: authorAnnotation.of(author) })
      return true
    },
    toggleFold: () => toggleFoldAt(view, view.state.doc.lineAt(view.state.selection.main.head).number),
    foldAll: () => foldAll(view),
    unfoldAll: () => unfoldAll(view),
    getFolds: () => foldedLines(view.state),
    setFolds: (lines) => restoreFolds(view, lines),

    getActiveFormats: () => activeFormats(view.state),

    setLivePreview: (on) => {
      view.dispatch({ effects: setLivePreview.of(on) })
    },

    setVim: (on) => {
      view.dispatch({ effects: vimMode.reconfigure(on ? vim({ status: true }) : []) })
    },

    focus: () => view.focus(),
    undo: () => {
      undo(view)
    },
    redo: () => {
      redo(view)
    },
    openSearch: () => {
      // The search panel's own keymap owns Mod+F; this is the menu path in.
      view.focus()
      view.dispatch({ effects: [] })
      const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, ctrlKey: true, bubbles: true })
      view.contentDOM.dispatchEvent(event)
    },
    destroy: () => view.destroy(),
  }
}
