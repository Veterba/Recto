import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { extensionOf } from '@shared/file-kind'
import { findInNote, openFind } from './find'

/**
 * The code editor: a vault file that is not a note - json, yaml, a script, a
 * log - in CodeMirror with line numbers, folding and the grammar its name
 * asks for. No live preview, no links, no properties: the text is shown and
 * saved exactly as it is.
 *
 * Like `codemirror.ts`, the rest of the app sees only the handle below.
 */

export type CodeHandle = {
  getValue: () => string
  /** Replace the text (an edit from another app), keeping history. */
  setValue: (next: string) => void
  /** Pretty-print JSON as one undoable edit. Null on success, else why not. */
  formatJson: () => string | null
  openFind: (replace: boolean) => void
  focus: () => void
  destroy: () => void
}

type CodeOptions = {
  doc: string
  path: string
  readOnly: boolean
  onChange: (value: string) => void
  onFocus?: () => void
}

/** Colours from the app's tokens only, like the note editor: keywords in the accent, the rest a step away. */
const codeHighlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier, tags.definitionKeyword], color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'hsl(calc(var(--accent-h) + 130) 45% var(--accent-l))' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'hsl(calc(var(--accent-h) + 200) 60% var(--accent-l))' },
  { tag: [tags.propertyName, tags.attributeName], color: 'hsl(calc(var(--accent-h) - 40) 55% var(--accent-l))' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'hsl(calc(var(--accent-h) + 60) 45% var(--accent-l))' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--text-primary)', fontWeight: '600' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator], color: 'var(--text-secondary)' },
  { tag: tags.heading, fontWeight: '650' },
  { tag: tags.invalid, color: 'var(--danger)' },
])

const codeTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--font-size-13)', color: 'var(--text-primary)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: 'var(--size-2) 0 30vh' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-muted) !important' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-hover) 30%, transparent)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--size-2) 0 var(--size-4)', minWidth: '3ch' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-secondary)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-hover)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    padding: '0 4px',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-muted)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: '3px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 42%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--chrome-strong)', color: 'var(--text-primary)', borderTop: '1px solid var(--border)' },
})

/**
 * JSON Lines: one record per line, each foldable to `{…}` on its own line.
 * Exported for the tests.
 */
export function recordFold(line: string): { from: number; to: number } | null {
  const open = line.search(/[{[]/)
  const close = Math.max(line.lastIndexOf('}'), line.lastIndexOf(']'))
  // Nothing worth hiding in `{}` or `{"a":1}`.
  if (open === -1 || close - open < 24) return null
  return { from: open + 1, to: close }
}

const jsonlFolding = foldService.of((state, lineStart, lineEnd) => {
  const range = recordFold(state.doc.sliceString(lineStart, lineEnd))
  return range === null ? null : { from: lineStart + range.from, to: lineStart + range.to }
})

/** The grammar for a file name, loaded the first time it is needed. */
function languageFor(path: string): LanguageDescription | null {
  const ext = extensionOf(path)
  if (ext === 'jsonl' || ext === 'ndjson') return LanguageDescription.matchLanguageName(languages, 'json')
  const name = path.slice(path.lastIndexOf('/') + 1)
  return LanguageDescription.matchFilename(languages, name)
}

export function createCodeEditor(parent: HTMLElement, options: CodeOptions): CodeHandle {
  const language = new Compartment()
  const ext = extensionOf(options.path)
  const jsonl = ext === 'jsonl' || ext === 'ndjson'

  const extensions: Extension[] = [
    lineNumbers(),
    foldGutter(),
    codeFolding(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    findInNote(),
    syntaxHighlighting(codeHighlighting),
    codeTheme,
    language.of([]),
    ...(jsonl ? [jsonlFolding] : [EditorView.lineWrapping]),
    EditorState.readOnly.of(options.readOnly),
    EditorView.editable.of(!options.readOnly),
    keymap.of([...historyKeymap, ...foldKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString())
    }),
  ]

  const view = new EditorView({ parent, state: EditorState.create({ doc: options.doc, extensions }) })
  view.dom.addEventListener('focusin', () => options.onFocus?.())

  let destroyed = false
  const description = languageFor(options.path)
  if (description !== null) {
    void description.load().then((support) => {
      if (!destroyed) view.dispatch({ effects: language.reconfigure(support) })
    })
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (next) => {
      if (next === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    },
    formatJson: () => {
      const text = view.state.doc.toString()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        return err instanceof Error ? err.message : 'Not valid JSON.'
      }
      const pretty = `${JSON.stringify(parsed, null, 2)}\n`
      if (pretty !== text) view.dispatch({ changes: { from: 0, to: text.length, insert: pretty }, userEvent: 'format' })
      return null
    },
    openFind: (replace) => openFind(view, replace),
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true
      view.destroy()
    },
  }
}
