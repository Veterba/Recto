import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { ChangeSpec, EditorState, TransactionSpec } from '@codemirror/state'

/**
 * Highlights, with Obsidian's colours: `==text==` is the default highlight,
 * and a colour emoji right after the opening marks colours it -
 * `==🔴text==`, `==🟠…==`, `==🟡…==`, `==🟢…==`, `==🔵…==`, `==🟣…==`. The
 * same bytes Obsidian 1.14.4 writes and reads; no other syntax.
 *
 * In Live Preview the marks and the emoji are hidden (shown again on the line
 * being edited, like other markup) and the text gets the colour. Changing a
 * colour rewrites the emoji and nothing else.
 */

export const HIGHLIGHT_COLOURS = [
  { id: 'red', emoji: '🔴', label: 'Red' },
  { id: 'orange', emoji: '🟠', label: 'Orange' },
  { id: 'yellow', emoji: '🟡', label: 'Yellow' },
  { id: 'green', emoji: '🟢', label: 'Green' },
  { id: 'blue', emoji: '🔵', label: 'Blue' },
  { id: 'purple', emoji: '🟣', label: 'Purple' },
] as const

export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number]['id']

/** `==…==` on one line, nothing but `=` excluded inside. */
export const HIGHLIGHT = /==([^=\n]+)==/g

export type Highlight = {
  /** The opening `==`. */
  from: number
  /** Just after the closing `==`. */
  to: number
  /** null: the default highlight. */
  colour: HighlightColour | null
  /** Where the highlighted text starts, after `==` and any emoji. */
  textFrom: number
  /** Where it ends, before the closing `==`. */
  textTo: number
}

const BY_EMOJI = new Map<string, HighlightColour>(HIGHLIGHT_COLOURS.map((c) => [c.emoji, c.id]))
const emojiOf = (colour: HighlightColour | null): string =>
  colour === null ? '' : (HIGHLIGHT_COLOURS.find((c) => c.id === colour)?.emoji ?? '')

/** The highlights in one line of text, at document positions from `offset`. */
export function highlightsIn(text: string, offset = 0): Highlight[] {
  const out: Highlight[] = []
  for (const match of text.matchAll(HIGHLIGHT)) {
    const from = offset + (match.index ?? 0)
    const inner = match[1] ?? ''
    // Every colour emoji is one code point, two UTF-16 units.
    const lead = inner.slice(0, 2)
    const colour = BY_EMOJI.get(lead) ?? null
    // A highlight that is only an emoji ("==🔴==") stays a default one around it.
    const textFrom = from + 2 + (colour !== null && inner.length > 2 ? 2 : 0)
    out.push({
      from,
      to: from + match[0].length,
      colour: textFrom === from + 2 ? null : colour,
      textFrom,
      textTo: from + match[0].length - 2,
    })
  }
  return out
}

/** The highlight around a position (or a range on one line), if any. */
export function highlightAt(state: EditorState, from: number, to = from): Highlight | null {
  const line = state.doc.lineAt(from)
  if (to > line.to) return null
  return highlightsIn(line.text, line.from).find((h) => h.from <= from && to <= h.to) ?? null
}

/**
 * Highlight the selection in a colour (null: the default), or, inside a
 * highlight, change its colour - the emoji is the only thing rewritten.
 * Nothing selected outside a highlight: empty marks, the caret between them.
 */
export function setHighlightColour(state: EditorState, colour: HighlightColour | null): TransactionSpec {
  const changes: ChangeSpec[] = []
  const emoji = emojiOf(colour)
  let anchor: number | null = null
  let head: number | null = null
  let shift = 0
  for (const range of state.selection.ranges) {
    const existing = highlightAt(state, range.from, range.to)
    if (existing !== null) {
      // Only the emoji: [after `==`, start of the text).
      changes.push({ from: existing.from + 2, to: existing.textFrom, insert: emoji })
      const delta = emoji.length - (existing.textFrom - existing.from - 2)
      if (anchor === null) {
        anchor = range.anchor + (range.anchor >= existing.textFrom ? delta : 0) + shift
        head = range.head + (range.head >= existing.textFrom ? delta : 0) + shift
      }
      shift += delta
      continue
    }
    const open = `==${emoji}`
    changes.push({ from: range.from, insert: open }, { from: range.to, insert: '==' })
    if (anchor === null) {
      anchor = range.from + open.length + shift
      head = range.to + open.length + shift
    }
    shift += open.length + 2
  }
  return {
    changes,
    ...(anchor === null || head === null ? {} : { selection: { anchor, head } }),
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/**
 * The toolbar's and ⌃⌘H's highlight: inside a highlight - of any colour -
 * take it away, marks and emoji; anywhere else, add a default one.
 */
export function toggleHighlight(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const existing = highlightAt(state, range.from, range.to)
  if (existing === null) return setHighlightColour(state, null)
  const lead = existing.textFrom - existing.from
  return {
    changes: [
      { from: existing.from, to: existing.textFrom, insert: '' },
      { from: existing.textTo, to: existing.to, insert: '' },
    ],
    selection: {
      anchor: Math.max(existing.from, range.anchor - lead),
      head: Math.max(existing.from, Math.min(existing.textTo - lead, range.head - lead)),
    },
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/**
 * Typing `==` to open a highlight offers the colours; picking one writes its
 * emoji, ignoring the list keeps the default. Only for an opening `==` - the
 * first, third… on the line - so closing one is left alone.
 */
export function highlightCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  if (!before.endsWith('==') || before.endsWith('===')) return null
  const opens = (before.match(/==/g) ?? []).length
  if (opens % 2 === 0) return null
  return {
    from: context.pos,
    options: HIGHLIGHT_COLOURS.map((c, i) => ({
      label: `${c.emoji} ${c.label}`,
      detail: 'highlight',
      apply: c.emoji,
      type: 'text',
      boost: -i,
    })),
    filter: false,
  }
}
