/**
 * What the rest of the app can do with an open editor.
 */

import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { WritingSettings } from './writing-modes'
import type { StoredRange, Author } from './authorship'
import type { Format } from './active-formats'

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
  /** Open the find bar, with the replace row when `replace` is set. */
  openFind: (replace: boolean) => void
  destroy: () => void
}
