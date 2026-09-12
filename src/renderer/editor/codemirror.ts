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
import { markdownDecorations, setUnresolvedTargets } from './decorations'
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
  /** Called when a wikilink is clicked, with the raw target text. */
  onOpenLink: (target: string) => void
  readOnly?: boolean
}

const editable = new Compartment()

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  /** Clicking a `[[wikilink]]` navigates; clicking elsewhere is a normal click. */
  const linkClick = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      if (!target?.classList.contains('cm-wikilink')) return false
      const pos = view.posAtDOM(target)
      const line = view.state.doc.lineAt(pos)
      const match = /\[\[([^\]|#]+)/.exec(line.text.slice(Math.max(0, pos - line.from - 40)))
      const name = match?.[1]?.trim() ?? target.textContent?.trim()
      if (name === undefined || name === '') return false
      event.preventDefault()
      options.onOpenLink(name)
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
        EditorState.allowMultipleSelections.of(true),
        // Markdown with GFM-ish extensions; the grammar is CM's own, so
        // highlighting stays incremental as you type.
        markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: true }),
        markdownHighlighting(),
        markdownDecorations(),
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
