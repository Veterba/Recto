import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

/**
 * The parts of Obsidian's markdown that CommonMark does not have, taught to
 * the grammar itself.
 *
 * In the grammar rather than as regexes over rendered lines, and the reason is
 * the bug that forced it: the parser did not know `$$` opens a block, so a
 * math block was ordinary paragraph text - and a `---` two lines under it
 * turned the heading, the formula and everything between into one enormous
 * setext H2. No amount of decoration can fix a wrong parse; the parse had to
 * change.
 *
 * Syntax covered, all as Obsidian writes it, so a note copied out of Obsidian
 * parses the same way here:
 *
 *   $$ ... $$          block math, over several lines
 *   $x$  $$x$$         inline math, and inline display math
 *   %% ... %%          comments, inline or over several lines
 *   [^1]               footnote references
 *
 * Callouts, embeds and tables are handled at the decoration layer: callouts are
 * ordinary blockquotes to the grammar (as they are in Obsidian), embeds are
 * image syntax with a wikilink inside, and tables are already GFM.
 */

const DOLLAR = 36
const BACKSLASH = 92
const PERCENT = 37
const SPACE = 32
const TAB = 9

const isDigit = (code: number): boolean => code >= 48 && code <= 57

/** The line's content from its current position, past any list or quote markers. */
const content = (line: Line): string => line.text.slice(line.pos)

/**
 * Does this line open a MULTI-line `$$` block?
 *
 * `$$x$$` on one line is not a block opener - it is inline display math, and
 * Obsidian treats `$$a$$ $$b$$ $$c$$` on one line as three formulas in a row.
 * Only a `$$` with no closing `$$` later on the same line starts a block.
 */
function opensMathBlock(line: Line): boolean {
  const text = content(line)
  return text.startsWith('$$') && !text.slice(2).includes('$$')
}

/** Same rule for `%%` comment blocks. */
function opensCommentBlock(line: Line): boolean {
  const text = content(line)
  return text.startsWith('%%') && !text.slice(2).includes('%%')
}

/** Consume lines up to and including the one holding `close`. */
function fenced(cx: BlockContext, line: Line, type: string, mark: string, close: string): boolean {
  const start = cx.lineStart + line.pos
  const marks = [cx.elt(mark, start, start + 2)]
  let end = cx.lineStart + line.text.length

  for (;;) {
    if (!cx.nextLine()) {
      // Unterminated: the block runs to the end of the document, which is what
      // a half-typed block looks like while it is being written.
      end = cx.prevLineEnd()
      break
    }
    const at = line.text.indexOf(close, line.pos)
    if (at >= 0) {
      const closeFrom = cx.lineStart + at
      marks.push(cx.elt(mark, closeFrom, closeFrom + 2))
      end = closeFrom + 2
      cx.nextLine()
      break
    }
    end = cx.lineStart + line.text.length
  }

  cx.addElement(cx.elt(type, start, end, marks))
  return true
}

/**
 * `$…$`, following the rules Pandoc and Obsidian share, so a price is not a
 * formula: the opening `$` must be followed by a non-space, the closing one
 * preceded by a non-space and NOT followed by a digit. "$5 and $10" stays text.
 */
function inlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1
  if (pos > cx.offset && cx.char(pos - 1) === BACKSLASH) return -1

  const display = cx.char(pos + 1) === DOLLAR
  const open = display ? 2 : 1
  const start = pos + open
  if (start >= cx.end) return -1
  const first = cx.char(start)
  if (first === DOLLAR) return -1
  if (!display && (first === SPACE || first === TAB)) return -1

  for (let i = start; i < cx.end; i++) {
    const code = cx.char(i)
    if (code === BACKSLASH) {
      i++
      continue
    }
    if (code !== DOLLAR) continue

    if (display) {
      if (cx.char(i + 1) !== DOLLAR) continue
      return cx.addElement(
        cx.elt('InlineMath', pos, i + 2, [cx.elt('MathMark', pos, pos + 2), cx.elt('MathMark', i, i + 2)]),
      )
    }

    const before = cx.char(i - 1)
    if (before === SPACE || before === TAB) continue
    if (isDigit(cx.char(i + 1))) continue
    return cx.addElement(
      cx.elt('InlineMath', pos, i + 1, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', i, i + 1)]),
    )
  }
  return -1
}

function inlineComment(cx: InlineContext, next: number, pos: number): number {
  if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1
  const close = cx.slice(pos + 2, cx.end).indexOf('%%')
  if (close < 0) return -1
  const end = pos + 2 + close + 2
  return cx.addElement(
    cx.elt('Comment', pos, end, [cx.elt('CommentMark', pos, pos + 2), cx.elt('CommentMark', end - 2, end)]),
  )
}

const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]/

function footnoteRef(cx: InlineContext, next: number, pos: number): number {
  if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1
  const match = FOOTNOTE_REF.exec(cx.slice(pos, Math.min(cx.end, pos + 80)))
  if (match === null) return -1
  // A definition line `[^1]: text` starts with the same thing; it is still a
  // reference to the grammar, and the decoration layer styles it as a label.
  return cx.addElement(cx.elt('FootnoteRef', pos, pos + match[0].length))
}

export const obsidianSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'MathBlock', block: true, style: tags.special(tags.string) },
    { name: 'InlineMath', style: tags.special(tags.string) },
    { name: 'MathMark', style: tags.processingInstruction },
    { name: 'CommentBlock', block: true, style: tags.comment },
    { name: 'Comment', style: tags.comment },
    { name: 'CommentMark', style: tags.comment },
    { name: 'FootnoteRef', style: tags.labelName },
  ],
  parseBlock: [
    {
      name: 'MathBlock',
      // Before paragraphs get a chance at the line, and before setext headings
      // can claim the text above a later `---`.
      before: 'FencedCode',
      parse: (cx, line) => (opensMathBlock(line) ? fenced(cx, line, 'MathBlock', 'MathMark', '$$') : false),
      // A `$$` line ends the paragraph above it, with no blank line needed -
      // exactly as it does in Obsidian.
      endLeaf: (_cx, line) => opensMathBlock(line),
    },
    {
      name: 'CommentBlock',
      before: 'FencedCode',
      parse: (cx, line) =>
        opensCommentBlock(line) ? fenced(cx, line, 'CommentBlock', 'CommentMark', '%%') : false,
      endLeaf: (_cx, line) => opensCommentBlock(line),
    },
  ],
  parseInline: [
    // Before emphasis and escapes, so `_` and `*` inside a formula are not
    // taken for italics - `$x_1 * y_2$` is maths, not two emphasis markers.
    { name: 'InlineMath', parse: inlineMath, before: 'Escape' },
    { name: 'Comment', parse: inlineComment, before: 'Escape' },
    { name: 'FootnoteRef', parse: footnoteRef, before: 'Link' },
  ],
}
