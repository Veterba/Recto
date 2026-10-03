/**
 * Markdown for a bot's answer, parsed into blocks and inline pieces that the
 * view turns into React elements - never HTML, so there is nothing to
 * sanitise. Covers what answers use: paragraphs, headings, lists, quotes,
 * fenced code, tables, rules; bold, italic, inline code, links and [[note]]
 * links. Note titles the answer mentions become note chips.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  /** A note: from a [[link]], or a title the answer mentions. */
  | { kind: 'note'; title: string; label: string }

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function parseBlocks(text: string, titles: readonly string[] = []): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  const inline = (t: string): Inline[] => parseInline(t, titles)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!)
      i++ // the closing fence; an unclosed one (an answer still streaming) runs to the end
      blocks.push({ kind: 'code', lang: fence[2] ?? '', code: code.join('\n') })
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, inline: inline(heading[2]!) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const head = cells(line).map(inline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) rows.push(cells(lines[i++]!).map(inline))
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!)
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted.join('\n'), titles) })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null
      const items: Inline[][] = []
      while (i < lines.length) {
        const item = ordered ? NUMBERED.exec(lines[i]!) : BULLET.exec(lines[i]!)
        if (item === null) {
          // A wrapped line continues the item before it.
          if (lines[i]!.trim() !== '' && /^\s{2,}/.test(lines[i]!) && items.length > 0) {
            items[items.length - 1] = [...items[items.length - 1]!, { kind: 'text', text: ' ' }, ...inline(lines[i]!.trim())]
            i++
            continue
          }
          break
        }
        items.push(inline(ordered ? item[2]! : item[1]!))
        i++
      }
      blocks.push({ kind: 'list', ordered, start: numbered !== null ? Number(numbered[1]) : 1, items })
      continue
    }
    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !FENCE.test(lines[i]!) &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBERED.test(lines[i]!) &&
      !QUOTE.test(lines[i]!)
    )
      paragraph.push(lines[i++]!)
    blocks.push({ kind: 'paragraph', inline: inline(paragraph.join('\n')) })
  }
  return blocks
}

const INLINE =
  /(\*\*|__)(.+?)\1|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)|`([^`]+)`|\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/

/**
 * Inline markdown. `titles` are notes the answer may mention by name (its
 * sources): each mention becomes a note chip - longest title first, so "Recto
 * plan" wins over "Recto".
 */
export function parseInline(text: string, titles: readonly string[] = []): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest !== '') {
    const match = INLINE.exec(rest)
    if (match === null) {
      out.push(...withTitles(rest, titles))
      break
    }
    if (match.index > 0) out.push(...withTitles(rest.slice(0, match.index), titles))
    if (match[2] !== undefined) out.push({ kind: 'bold', children: parseInline(match[2], titles) })
    else if (match[3] !== undefined) out.push({ kind: 'italic', children: parseInline(match[3], titles) })
    else if (match[4] !== undefined) out.push({ kind: 'italic', children: parseInline(match[4], titles) })
    else if (match[5] !== undefined) out.push({ kind: 'code', text: match[5] })
    else if (match[6] !== undefined) out.push({ kind: 'note', title: match[6].trim(), label: (match[7] ?? match[6]).trim() })
    else if (match[8] !== undefined) out.push({ kind: 'link', text: match[8], href: match[9]! })
    rest = rest.slice(match.index + match[0].length)
  }
  return out
}

function withTitles(text: string, titles: readonly string[]): Inline[] {
  const sorted = [...titles].filter((t) => t.trim().length >= 3).sort((a, b) => b.length - a.length)
  for (const title of sorted) {
    const at = indexOfWhole(text, title)
    if (at === -1) continue
    return [
      ...withTitles(text.slice(0, at), titles),
      { kind: 'note', title, label: text.slice(at, at + title.length) },
      ...withTitles(text.slice(at + title.length), titles),
    ]
  }
  return text === '' ? [] : [{ kind: 'text', text }]
}

/** Where `title` occurs in `text` as a whole phrase (not inside a longer word), ignoring case; -1 if nowhere. */
function indexOfWhole(text: string, title: string): number {
  const lower = text.toLowerCase()
  const needle = title.toLowerCase()
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
    const before = at === 0 ? '' : text[at - 1]!
    const after = text[at + needle.length] ?? ''
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return at
  }
  return -1
}
