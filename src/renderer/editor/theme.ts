import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * The editor's look, expressed entirely in the app's CSS variables.
 *
 * No colour is written here - every value points at a token, so switching theme
 * or changing the accent hue repaints the editor with the rest of the app and
 * there is no second palette to keep in sync. It is also what makes the
 * translucent/glass direction cheap later: the surfaces are already tokens.
 */

export const editorTheme = (): Extension =>
  EditorView.theme({
    '&': {
      height: '100%',
      fontSize: 'var(--editor-font-size, 14px)',
      color: 'var(--text-primary)',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-editor, var(--font-mono))',
      lineHeight: '1.75',
      padding: '0 var(--size-6) 40vh',
      overflow: 'auto',
    },
    // A long tail of blank space at the bottom, so the last line of a note can
    // still be typed at eye level rather than pinned to the window edge.
    '.cm-content': {
      caretColor: 'var(--accent)',
      maxWidth: '78ch',
      margin: '0 auto',
      padding: 'var(--size-4) 0 0',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--accent-muted) !important',
    },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-muted) !important' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-hover) 45%, transparent)' },
    '.cm-gutters': { display: 'none' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-hover)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      color: 'var(--text-muted)',
      padding: '0 6px',
      margin: '0 2px',
    },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
      borderRadius: '3px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 42%, transparent)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      borderTop: '1px solid var(--border)',
    },
    '.cm-panel input': {
      font: 'inherit',
      color: 'var(--text-primary)',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      padding: '2px 6px',
    },
    '.cm-panel button': {
      font: 'inherit',
      color: 'var(--text-secondary)',
      background: 'var(--bg-hover)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
    },
  })

/**
 * Markdown syntax highlighting.
 *
 * Headings get size and weight, not just colour: in source mode the structure
 * of a document should be legible at a glance without rendering it. This is
 * also the groundwork for Live Preview, which hides the markers and keeps
 * exactly these styles.
 */
export const markdownHighlighting = (): Extension =>
  syntaxHighlighting(
    HighlightStyle.define([
      // Every level is a power of one ratio, so a single setting makes the
      // document's structure louder or quieter without six values drifting
      // apart. `--heading-scale` is set from appearance.
      {
        tag: tags.heading1,
        fontSize: 'calc(pow(var(--heading-scale, 1.25), 3) * 1em)',
        fontWeight: '650',
        lineHeight: '1.3',
        fontFamily: 'var(--font-heading, inherit)',
      },
      {
        tag: tags.heading2,
        fontSize: 'calc(pow(var(--heading-scale, 1.25), 2) * 1em)',
        fontWeight: '650',
        lineHeight: '1.35',
        fontFamily: 'var(--font-heading, inherit)',
      },
      {
        tag: tags.heading3,
        fontSize: 'calc(var(--heading-scale, 1.25) * 1em)',
        fontWeight: '600',
        fontFamily: 'var(--font-heading, inherit)',
      },
      {
        tag: tags.heading4,
        fontSize: 'calc(1em + (var(--heading-scale, 1.25) - 1) * 0.35em)',
        fontWeight: '600',
        fontFamily: 'var(--font-heading, inherit)',
      },
      {
        tag: [tags.heading5, tags.heading6],
        fontWeight: '600',
        fontFamily: 'var(--font-heading, inherit)',
      },
      { tag: tags.strong, fontWeight: '700', color: 'var(--text-primary)' },
      { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
      { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
      { tag: tags.url, color: 'var(--text-muted)' },
      { tag: tags.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
      { tag: tags.monospace, color: 'var(--accent)' },
      { tag: tags.list, color: 'var(--text-secondary)' },
      // The syntax characters themselves - '##', '**', '`' - recede.
      { tag: tags.processingInstruction, color: 'var(--text-muted)', opacity: '0.6' },
      { tag: tags.contentSeparator, color: 'var(--text-muted)' },
      { tag: tags.meta, color: 'var(--text-muted)' },
      { tag: tags.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
      { tag: tags.keyword, color: 'var(--accent)' },
      { tag: tags.string, color: 'var(--text-secondary)' },
    ]),
  )
