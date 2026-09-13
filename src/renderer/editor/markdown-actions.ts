import type { ChangeSpec, EditorState, TransactionSpec } from '@codemirror/state'

/**
 * The markdown editing operations, as pure state transforms.
 *
 * Every one takes an `EditorState` and returns a `TransactionSpec`, so they are
 * testable in plain Node with no DOM and no editor view. That matters because
 * this is where the fiddly behaviour lives: toggling off as well as on, acting
 * on every line of a multi-line selection, and putting the cursor somewhere
 * sensible afterwards.
 *
 * CodeMirror types appear in these signatures but are never re-exported from
 * anything the rest of the app imports - the wrapper in `editor.ts` is the only
 * boundary that knows about CM.
 */

/** Lines touched by any selection range, de-duplicated. */
function selectedLines(state: EditorState): { from: number; to: number; text: string; number: number }[] {
  const lines = new Map<number, { from: number; to: number; text: string; number: number }>()
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from)
    const end = state.doc.lineAt(range.to)
    for (let n = start.number; n <= end.number; n++) {
      const line = state.doc.line(n)
      lines.set(n, { from: line.from, to: line.to, text: line.text, number: n })
    }
  }
  return [...lines.values()].sort((a, b) => a.number - b.number)
}

/** Existing markdown prefix on a line, e.g. '## ', '- [ ] ', '> '. */
const PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s+)?/

function splitPrefix(text: string): { indent: string; prefix: string; body: string } {
  const match = PREFIX.exec(text)
  const indent = match?.[1] ?? ''
  const prefix = match?.[2] ?? ''
  return { indent, prefix, body: text.slice(indent.length + prefix.length) }
}

/**
 * Replace the block prefix on every selected line.
 *
 * Toggling: if every selected line already has exactly this prefix, it is
 * removed instead. Without that, "make this a heading" would be a one-way door.
 */
export function setLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  const lines = selectedLines(state)
  const allHave = lines.length > 0 && lines.every((line) => splitPrefix(line.text).prefix === prefix)
  const changes: ChangeSpec[] = []

  for (const line of lines) {
    const { indent, body } = splitPrefix(line.text)
    const next = allHave ? `${indent}${body}` : `${indent}${prefix}${body}`
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }

  return { changes, scrollIntoView: true, userEvent: 'input.format' }
}

export const toggleHeading = (state: EditorState, level: 1 | 2 | 3 | 4 | 5 | 6): TransactionSpec =>
  setLinePrefix(state, `${'#'.repeat(level)} `)

export const toggleBulletList = (state: EditorState): TransactionSpec => setLinePrefix(state, '- ')
export const toggleQuote = (state: EditorState): TransactionSpec => setLinePrefix(state, '> ')

/**
 * Ordered lists renumber per line, so this cannot go through setLinePrefix.
 */
export function toggleNumberedList(state: EditorState): TransactionSpec {
  const lines = selectedLines(state)
  const allHave = lines.length > 0 && lines.every((line) => /^\s*\d+\.\s+/.test(line.text))
  const changes: ChangeSpec[] = []

  lines.forEach((line, i) => {
    const { indent, body } = splitPrefix(line.text)
    const next = allHave ? `${indent}${body}` : `${indent}${i + 1}. ${body}`
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  })

  return { changes, scrollIntoView: true, userEvent: 'input.format' }
}

/**
 * Checklists are three-state, not two: a plain line becomes `- [ ]`, an
 * unchecked box becomes checked, and a checked box goes back to a plain line.
 * Cycling through "done" is what people actually want from one keystroke.
 */
export function toggleChecklist(state: EditorState): TransactionSpec {
  const lines = selectedLines(state)
  const changes: ChangeSpec[] = []

  const allUnchecked = lines.length > 0 && lines.every((line) => /^\s*[-*+]\s+\[ \]\s+/.test(line.text))
  const allChecked = lines.length > 0 && lines.every((line) => /^\s*[-*+]\s+\[[xX]\]\s+/.test(line.text))

  for (const line of lines) {
    const { indent, body } = splitPrefix(line.text)
    let next: string
    if (allChecked) next = `${indent}${body}`
    else if (allUnchecked) next = `${indent}- [x] ${body}`
    else next = `${indent}- [ ] ${body}`
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }

  return { changes, scrollIntoView: true, userEvent: 'input.format' }
}

/**
 * Wrap (or unwrap) each selection range in a marker.
 *
 * An empty selection inserts the markers and places the cursor between them, so
 * `⌘B` then typing works the way it does in every other editor.
 */
export function toggleWrap(state: EditorState, open: string, close = open): TransactionSpec {
  const changes: ChangeSpec[] = []
  const ranges: { anchor: number; head: number }[] = []
  let offset = 0

  for (const range of state.selection.ranges) {
    const before = state.doc.sliceString(Math.max(0, range.from - open.length), range.from)
    const after = state.doc.sliceString(range.to, Math.min(state.doc.length, range.to + close.length))
    const selected = state.doc.sliceString(range.from, range.to)

    // Markers just outside the selection: unwrap.
    if (before === open && after === close) {
      changes.push({ from: range.from - open.length, to: range.from, insert: '' })
      changes.push({ from: range.to, to: range.to + close.length, insert: '' })
      ranges.push({ anchor: range.from + offset - open.length, head: range.to + offset - open.length })
      offset -= open.length + close.length
      continue
    }

    // Markers inside the selection: unwrap.
    if (selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
      const inner = selected.slice(open.length, selected.length - close.length)
      changes.push({ from: range.from, to: range.to, insert: inner })
      ranges.push({ anchor: range.from + offset, head: range.from + offset + inner.length })
      offset -= open.length + close.length
      continue
    }

    changes.push({ from: range.from, insert: open })
    changes.push({ from: range.to, insert: close })
    ranges.push({
      anchor: range.from + offset + open.length,
      head: range.to + offset + open.length,
    })
    offset += open.length + close.length
  }

  return {
    changes,
    selection: ranges.length > 0 ? { anchor: ranges[0]!.anchor, head: ranges[0]!.head } : undefined,
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

export const toggleBold = (state: EditorState): TransactionSpec => toggleWrap(state, '**')
export const toggleItalic = (state: EditorState): TransactionSpec => toggleWrap(state, '*')
export const toggleInlineCode = (state: EditorState): TransactionSpec => toggleWrap(state, '`')
export const toggleStrikethrough = (state: EditorState): TransactionSpec => toggleWrap(state, '~~')
export const toggleHighlight = (state: EditorState): TransactionSpec => toggleWrap(state, '==')

/** `[text](url)` with the cursor left in the url, or in the text if empty. */
export function insertLink(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const text = state.doc.sliceString(range.from, range.to)
  const insert = `[${text}]()`
  return {
    changes: { from: range.from, to: range.to, insert },
    // Cursor inside the parentheses, ready for a URL.
    selection: { anchor: range.from + insert.length - 1 },
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/** `[[target]]`, cursor inside the brackets when nothing was selected. */
export function insertWikiLink(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const text = state.doc.sliceString(range.from, range.to)
  const insert = `[[${text}]]`
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + 2 + text.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/** A fenced block around the selection, or an empty one with the cursor inside. */
export function insertCodeBlock(state: EditorState): TransactionSpec {
  const range = state.selection.main
  const selected = state.doc.sliceString(range.from, range.to)
  const line = state.doc.lineAt(range.from)
  const atLineStart = range.from === line.from
  const lead = atLineStart ? '' : '\n'
  const insert = `${lead}\`\`\`\n${selected}\n\`\`\`\n`
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + lead.length + 4 + selected.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/**
 * A horizontal rule.
 *
 * The blank line before it is not cosmetic. `---` directly under a line of text
 * is a *setext heading* in CommonMark - it turns the paragraph above into an
 * H2 instead of drawing a rule. That is why the old version appeared to "just
 * write ---" and do nothing: it wrote a heading marker.
 *
 * `***` would dodge the ambiguity, but `---` is what every other editor writes
 * and what the user will see elsewhere, so the fix is the blank line.
 */
export function insertHorizontalRule(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head)
  const emptyHere = line.text.trim() === ''
  const previousBlank = line.number === 1 || state.doc.line(line.number - 1).text.trim() === ''
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null

  // Exactly one blank line above the rule. Sitting on a blank line is not
  // enough on its own: `text` / `` / `---` is fine, but `text` / `---` is a
  // setext heading, and the cursor's own blank line is where the rule goes.
  const before = emptyHere ? (previousBlank ? '' : '\n') : '\n\n'
  // The insert lands at the END of the current line, so the document's own
  // newline already follows it - adding another would leave a stray blank.
  const after = next !== null && next.text.trim() === '' ? '' : '\n'
  const insert = `${before}---${after}`

  return {
    changes: { from: line.to, insert },
    selection: { anchor: line.to + insert.length },
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/**
 * Paragraph alignment.
 *
 * Markdown has no alignment syntax, so this writes the one thing every reader
 * understands: a `<div align="...">` wrapper. It renders correctly in Obsidian,
 * on GitHub, and anywhere else the file is opened - which a bespoke marker
 * would not. The cost is visible HTML in the source, and that is the honest
 * trade rather than a syntax only this app can read.
 *
 * Left is the default, so choosing it removes the wrapper instead of writing
 * `align="left"` - otherwise every paragraph you ever centred and then undid
 * would leave a div behind.
 */
export type Alignment = 'left' | 'center' | 'right' | 'justify'

const ALIGN_OPEN = /^\s*<div align="(left|center|right|justify)">\s*$/
const ALIGN_CLOSE = /^\s*<\/div>\s*$/

/** The run of non-blank lines the selection sits in. */
function blockAround(state: EditorState): { first: number; last: number } {
  const lines = selectedLines(state)
  let first = lines[0]?.number ?? state.doc.lineAt(state.selection.main.head).number
  let last = lines[lines.length - 1]?.number ?? first

  while (first > 1 && state.doc.line(first - 1).text.trim() !== '') {
    if (ALIGN_OPEN.test(state.doc.line(first - 1).text)) break
    first--
  }
  while (last < state.doc.lines && state.doc.line(last + 1).text.trim() !== '') {
    if (ALIGN_CLOSE.test(state.doc.line(last + 1).text)) break
    last++
  }
  return { first, last }
}

/** The alignment wrapping the cursor's block, if any. */
export function alignmentAt(state: EditorState): Alignment | null {
  const { first, last } = blockAround(state)
  if (first < 2 || last >= state.doc.lines) return null
  const open = ALIGN_OPEN.exec(state.doc.line(first - 1).text)
  if (open?.[1] === undefined) return null
  if (!ALIGN_CLOSE.test(state.doc.line(last + 1).text)) return null
  return open[1] as Alignment
}

export function setAlignment(state: EditorState, alignment: Alignment): TransactionSpec | null {
  const { first, last } = blockAround(state)
  const current = alignmentAt(state)

  // Already wrapped: retarget the open tag, or unwrap when the choice is the
  // default or a second press of the same button.
  if (current !== null) {
    const openLine = state.doc.line(first - 1)
    const closeLine = state.doc.line(last + 1)
    if (alignment === 'left' || alignment === current) {
      return {
        changes: [
          // Each tag takes its own line separator with it, or unwrapping leaves
          // a blank line behind. The opening tag takes the newline AFTER it;
          // the closing tag takes the one BEFORE it, which is the newline that
          // ends the last line of content.
          { from: openLine.from, to: Math.min(openLine.to + 1, state.doc.length) },
          { from: Math.max(0, closeLine.from - 1), to: closeLine.to },
        ],
        scrollIntoView: true,
        userEvent: 'input.format',
      }
    }
    return {
      changes: { from: openLine.from, to: openLine.to, insert: `<div align="${alignment}">` },
      scrollIntoView: true,
      userEvent: 'input.format',
    }
  }

  // Nothing to do: left is what an unwrapped block already is.
  if (alignment === 'left') return null

  const firstLine = state.doc.line(first)
  const lastLine = state.doc.line(last)
  return {
    changes: [
      { from: firstLine.from, insert: `<div align="${alignment}">\n` },
      { from: lastLine.to, insert: `\n</div>` },
    ],
    scrollIntoView: true,
    userEvent: 'input.format',
  }
}

/** Move the selected lines up or down, keeping the selection on them. */
export function moveLines(state: EditorState, direction: -1 | 1): TransactionSpec | null {
  const lines = selectedLines(state)
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!first || !last) return null

  const targetNumber = direction === -1 ? first.number - 1 : last.number + 1
  if (targetNumber < 1 || targetNumber > state.doc.lines) return null

  const target = state.doc.line(targetNumber)
  const block = state.doc.sliceString(first.from, last.to)
  const shift = direction === -1 ? -(target.text.length + 1) : target.text.length + 1

  const insert =
    direction === -1 ? `${block}\n${target.text}` : `${target.text}\n${block}`
  const from = direction === -1 ? target.from : first.from
  const to = direction === -1 ? last.to : target.to

  return {
    changes: { from, to, insert },
    selection: { anchor: first.from + shift, head: last.to + shift },
    scrollIntoView: true,
    userEvent: 'move.line',
  }
}

/**
 * Which formats apply at the cursor.
 *
 * Drives the toolbar's pressed state. Pure, so the "is this bold" rule is
 * tested rather than eyeballed - and it has to agree with what the toggles do,
 * or a button will look off while its shortcut turns the format off.
 */
export type Format =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'bold'
  | 'italic'
  | 'code'
  | 'strikethrough'
  | 'highlight'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'quote'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'

const WRAPPERS: readonly { format: Format; marker: string }[] = [
  // Longest first: '**' must be tested before '*', or bold always reads as italic.
  { format: 'bold', marker: '**' },
  { format: 'strikethrough', marker: '~~' },
  { format: 'highlight', marker: '==' },
  { format: 'italic', marker: '*' },
  { format: 'code', marker: '`' },
]

export function activeFormats(state: EditorState): Set<Format> {
  const active = new Set<Format>()
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)

  // --- block formats, from the line prefix ---
  const heading = /^\s*(#{1,6})\s/.exec(line.text)
  if (heading?.[1] !== undefined) active.add(`heading-${heading[1].length}` as Format)
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line.text)) active.add('task')
  else if (/^\s*[-*+]\s/.test(line.text)) active.add('bullet')
  if (/^\s*\d+\.\s/.test(line.text)) active.add('numbered')
  if (/^\s*>\s/.test(line.text)) active.add('quote')

  // Alignment is a wrapper around the block, not a prefix on the line.
  const alignment = alignmentAt(state)
  if (alignment !== null) active.add(`align-${alignment}` as Format)

  // --- inline formats, by looking outward from the cursor ---
  const text = line.text
  const offset = range.head - line.from
  const selected = state.doc.sliceString(range.from, range.to)

  for (const { format, marker } of WRAPPERS) {
    if (active.has(format)) continue

    // A selection that is itself wrapped.
    if (
      selected.length >= marker.length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      active.add(format)
      continue
    }
    // Markers immediately outside the selection.
    const before = state.doc.sliceString(Math.max(0, range.from - marker.length), range.from)
    const after = state.doc.sliceString(range.to, Math.min(state.doc.length, range.to + marker.length))
    if (before === marker && after === marker) {
      active.add(format)
      continue
    }
    // A bare cursor inside a pair on this line.
    const openAt = text.lastIndexOf(marker, Math.max(0, offset - 1))
    if (openAt === -1) continue
    const closeAt = text.indexOf(marker, openAt + marker.length)
    if (closeAt !== -1 && offset > openAt && offset <= closeAt + marker.length) active.add(format)
  }

  // '**bold**' contains '*', so bold implies a false italic and code reading.
  if (active.has('bold')) active.delete('italic')

  return active
}
