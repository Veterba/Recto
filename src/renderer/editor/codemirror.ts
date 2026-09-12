import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  rectangularSelection,
} from '@codemirror/view'
import { activeFormats, type Format } from './markdown-actions'
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
}

const editable = new Compartment()

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

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentOnInput(),
        foldGutter(),
        search({ top: true }),
        ...(options.getLinkCandidates === undefined ? [] : [linkCompletion(options.getLinkCandidates)]),
        EditorState.allowMultipleSelections.of(true),
        // Markdown with GFM-ish extensions; the grammar is CM's own, so
        // highlighting stays incremental as you type.
        markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: true }),
        markdownHighlighting(),
        markdownDecorations(),
        // Live Preview sits in a compartment so the mode can be switched at
        // runtime without rebuilding the editor and losing undo history.
        livePreviewCompartment.of(
          livePreview((v) => v.state.field(unresolvedField, false) ?? new Set<string>()),
        ),
        editorTheme(),
        linkClick,
        EditorView.lineWrapping,
        editable.of(EditorView.editable.of(options.readOnly !== true)),
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
      if (next === view.state.doc.toString()) return
      const selection = view.state.selection.main
      const length = next.length
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        // Keep the caret where it was, clamped to the new length. Losing the
        // cursor on every external change makes co-editing unusable.
        selection: { anchor: Math.min(selection.anchor, length), head: Math.min(selection.head, length) },
      })
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
