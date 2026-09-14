import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
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
}

const editable = new Compartment()
/**
 * Vim lives in a compartment so the setting can be flipped without rebuilding
 * the editor - which would lose the cursor, the scroll position and the undo
 * history every time someone tried it out.
 */
const vimMode = new Compartment()

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  /** Clicking a `[[wikilink]]` navigates; clicking elsewhere is a normal click. */
  const linkClick = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      if (!target?.classList.contains('cm-wikilink')) return false
      // The decoration spans the whole inside of the brackets, so the element's
      // own text is the link - no need to re-scan the line and guess.
      const inner = target.textContent ?? ''
      const parsed = /^([^#|]+)(?:#([^|]+))?/.exec(inner.trim())
      const name = parsed?.[1]?.trim()
      if (name === undefined || name === '') return false
      event.preventDefault()
      options.onOpenLink(name, parsed?.[2]?.trim() ?? null)
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
        foldGutter(),
        search({ top: true }),
        ...(options.getLinkCandidates === undefined ? [] : [linkCompletion(options.getLinkCandidates)]),
        EditorState.allowMultipleSelections.of(true),
        // Markdown with GFM-ish extensions; the grammar is CM's own, so
        // highlighting stays incremental as you type.
        // `languages` lazy-loads a grammar the first time a fence names it, so
        // a vault with no code costs nothing and ```python highlights properly.
        // This is what `codeLanguages: []` was a placeholder for.
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
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
          ...foldKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString())
          // The toolbar needs to know on both, because typing can enter or
          // leave a format without the cursor being moved by hand.
          if (update.docChanged || update.selectionSet) options.onSelectionChange?.()
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
