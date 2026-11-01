/**
 * The formatting profile: how the person's notes are laid out, so text an AI
 * proposes reads as if they wrote it.
 *
 * Each rule is a small set of options and every rule has "Leave as written",
 * which makes no edit at all. Rule semantics follow Obsidian Linter's where
 * one matches (named in RULES), so a vault already kept by Linter keeps
 * looking the same. Anything no rule covers is never touched, and neither is
 * frontmatter or the inside of a code block.
 *
 * Formatting a proposal touches only what the AI wrote: `formatChanged`
 * formats the whole proposed note but keeps only the edits on lines the AI
 * added or changed, plus the blank lines right beside them. The person's own
 * text is never reformatted.
 */

import { frontmatterClose } from './frontmatter'
import { changedLines } from './line-diff'

export type FormattingProfile = {
  headingBlankBefore: 'leave' | 'one'
  headingBlankAfter: 'leave' | 'one' | 'none'
  headingLevels: 'leave' | 'no-skip' | 'no-skip-h2'
  titleHeading: 'leave' | 'never' | 'always'
  paragraphBlankLines: 'leave' | 'one'
  maxBlankLines: 'leave' | '1' | '2'
  listMarker: 'leave' | '-' | '*' | '+'
  linkForm: 'leave' | 'wiki' | 'markdown'
}

export type RuleKey = keyof FormattingProfile

export const LEAVE_ALL: FormattingProfile = {
  headingBlankBefore: 'leave',
  headingBlankAfter: 'leave',
  headingLevels: 'leave',
  titleHeading: 'leave',
  paragraphBlankLines: 'leave',
  maxBlankLines: 'leave',
  listMarker: 'leave',
  linkForm: 'leave',
}

export type RuleInfo = {
  key: RuleKey
  label: string
  /** The Obsidian Linter rule with the same meaning, or null when Linter has none. */
  linter: string | null
  options: readonly { value: string; label: string }[]
}

const LEAVE = { value: 'leave', label: 'Leave as written' }

export const RULES: readonly RuleInfo[] = [
  {
    key: 'headingBlankBefore',
    label: 'Blank line before headings',
    linter: 'heading-blank-lines',
    options: [LEAVE, { value: 'one', label: 'One' }],
  },
  {
    key: 'headingBlankAfter',
    label: 'Blank line after headings',
    linter: 'heading-blank-lines',
    options: [LEAVE, { value: 'one', label: 'One' }, { value: 'none', label: 'None' }],
  },
  {
    key: 'headingLevels',
    label: 'Heading levels',
    linter: 'header-increment',
    options: [LEAVE, { value: 'no-skip', label: 'No skipped levels' }, { value: 'no-skip-h2', label: 'No skipped levels, start at H2' }],
  },
  {
    key: 'titleHeading',
    label: 'Title heading at the top',
    linter: 'file-name-heading',
    options: [LEAVE, { value: 'never', label: 'Never (the name is the title)' }, { value: 'always', label: 'Always “# Note name”' }],
  },
  {
    key: 'paragraphBlankLines',
    label: 'Blank lines between paragraphs',
    linter: 'paragraph-blank-lines',
    options: [LEAVE, { value: 'one', label: 'One' }],
  },
  {
    key: 'maxBlankLines',
    label: 'Most blank lines in a row',
    linter: 'consecutive-blank-lines',
    options: [LEAVE, { value: '1', label: '1' }, { value: '2', label: '2' }],
  },
  {
    key: 'listMarker',
    label: 'List marker',
    linter: 'unordered-list-style',
    options: [LEAVE, { value: '-', label: '-' }, { value: '*', label: '*' }, { value: '+', label: '+' }],
  },
  {
    key: 'linkForm',
    label: 'Link form',
    linter: null,
    options: [LEAVE, { value: 'wiki', label: '[[Note name]]' }, { value: 'markdown', label: '[text](path.md)' }],
  },
]

/** A profile read from anywhere (settings on disk), with every unknown value as "leave". */
export function coerceProfile(value: unknown): FormattingProfile {
  const raw = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const out = { ...LEAVE_ALL } as Record<RuleKey, string>
  for (const rule of RULES) {
    const v = raw[rule.key]
    if (typeof v === 'string' && rule.options.some((o) => o.value === v)) out[rule.key] = v
  }
  return out as FormattingProfile
}

// ---------------------------------------------------------------------------
// Reading a note into lines and blocks

type Kind = 'blank' | 'heading' | 'list' | 'para' | 'code' | 'other'

const HEADING = /^(#{1,6})(\s+)(.*)$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLET = /^(\s*)([-*+])(\s+)(?=\S)/
const ORDERED = /^\s*\d+[.)]\s/
const FENCE = /^\s*(```|~~~)/

const kindOf = (text: string): Kind => {
  if (text.trim() === '') return 'blank'
  if (HEADING.test(text)) return 'heading'
  if (HR.test(text)) return 'other'
  if (BULLET.test(text) || ORDERED.test(text)) return 'list'
  // Quotes, tables, indented continuations, callouts: not paragraphs, never reflowed.
  if (/^[>|\s]/.test(text) || /^<|^\$\$|^%%/.test(text)) return 'other'
  return 'para'
}

/** One line on its way through: where it came from (null when a rule made it), and what it is. */
type Line = { text: string; id: number | null; kind: Kind }

/** The body's lines, each code block's lines marked `code` so nothing edits them. */
function readLines(lines: readonly string[], from: number): Line[] {
  const out: Line[] = []
  let fence: string | null = null
  for (let i = from; i < lines.length; i++) {
    const text = lines[i]!
    const open = FENCE.exec(text)
    if (fence !== null) {
      out.push({ text, id: i, kind: 'code' })
      if (open !== null && open[1] === fence) fence = null
    } else if (open !== null) {
      fence = open[1]!
      out.push({ text, id: i, kind: 'code' })
    } else out.push({ text, id: i, kind: kindOf(text) })
  }
  return out
}

const level = (text: string): number => HEADING.exec(text)?.[1]?.length ?? 0
const headingText = (text: string): string => (HEADING.exec(text)?.[3] ?? '').replace(/\s+#+\s*$/, '').trim()
const sameName = (a: string, b: string): boolean => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

// ---------------------------------------------------------------------------
// Formatting

export type LinkForms = {
  /** A Markdown link's target (a vault path) as the shortest wiki-link target, or null when it is no note. */
  toWiki: (path: string) => string | null
  /** A wiki link's target as a vault path, or null when it resolves to nothing. */
  toPath: (target: string) => string | null
}

export type FormatContext = {
  /** The note's name, without .md: the title heading's text. */
  name: string
  links?: LinkForms
}

export type FormatResult = { text: string; applied: RuleKey[] }

const MD_LINK = /(?<!!)\[([^\]\n]*)\]\(([^()\s]+\.md)\)/g
const WIKI_LINK = /(?<!!)\[\[([^\]|#\n]+)(\|[^\]\n]*)?\]\]/g

function convertLinks(text: string, form: 'wiki' | 'markdown', links: LinkForms): string {
  if (form === 'wiki')
    return text.replace(MD_LINK, (whole, label: string, target: string) => {
      let decoded: string
      try {
        decoded = decodeURI(target)
      } catch {
        return whole
      }
      const wiki = links.toWiki(decoded)
      if (wiki === null) return whole
      const name = wiki.slice(wiki.lastIndexOf('/') + 1)
      return label === '' || sameName(label, name) ? `[[${wiki}]]` : `[[${wiki}|${label}]]`
    })
  return text.replace(WIKI_LINK, (whole, target: string, alias: string | undefined) => {
    const resolved = links.toPath(target.trim())
    if (resolved === null) return whole
    const label = alias === undefined ? target.trim().slice(target.trim().lastIndexOf('/') + 1) : alias.slice(1)
    return `[${label}](${encodeURI(resolved)})`
  })
}

/**
 * Format `text` by `profile`, editing only where `canEdit` allows: a line's
 * own text when its line may be edited; the blank lines between two blocks
 * when either block, or one of those blank lines, may be.
 */
export function formatText(
  text: string,
  profile: FormattingProfile,
  ctx: FormatContext,
  canEdit: (id: number) => boolean = () => true,
): FormatResult {
  const all = text.split('\n')
  const close = frontmatterClose(all)
  const head = all.slice(0, close + 1)
  let lines = readLines(all, close + 1)
  const applied = new Set<RuleKey>()
  const may = (line: Line): boolean => line.id === null || canEdit(line.id)
  const set = (line: Line, next: string, rule: RuleKey): void => {
    if (next === line.text) return
    line.text = next
    line.kind = kindOf(next)
    applied.add(rule)
  }

  // The title heading first: the heading levels below depend on whether it is there.
  const first = lines.findIndex((l) => l.kind !== 'blank')
  const top = first === -1 ? null : lines[first]!
  const isTitle = top !== null && top.kind === 'heading' && level(top.text) === 1 && sameName(headingText(top.text), ctx.name)
  if (profile.titleHeading === 'never' && isTitle && may(top)) {
    let end = first + 1
    while (end < lines.length && lines[end]!.kind === 'blank' && may(lines[end]!)) end++
    lines = [...lines.slice(0, first), ...lines.slice(end)]
    applied.add('titleHeading')
  } else if (profile.titleHeading === 'always' && !(top !== null && top.kind === 'heading' && level(top.text) === 1)) {
    // Only where the AI wrote the top of the note - a new note, or a new first line.
    if (top === null ? lines.every(may) : may(top)) {
      const at = first === -1 ? lines.length : first
      const title: Line[] = [{ text: `# ${ctx.name}`, id: null, kind: 'heading' }]
      if (top !== null) title.push({ text: '', id: null, kind: 'blank' })
      lines = [...lines.slice(0, at), ...title, ...lines.slice(at)]
      applied.add('titleHeading')
    }
  }

  // Per-line rules.
  let previous = profile.headingLevels === 'no-skip-h2' ? 1 : 0
  let firstHeading = true
  for (const line of lines) {
    if (line.kind === 'heading' && profile.headingLevels !== 'leave') {
      const current = level(line.text)
      const title = current === 1 && sameName(headingText(line.text), ctx.name) && line === lines.find((l) => l.kind !== 'blank')
      let wanted = current
      if (profile.headingLevels === 'no-skip-h2' && current === 1 && !title) wanted = 2
      // The first heading may start anywhere in "no skipped levels"; after it, one level deeper at most.
      if (!(firstHeading && profile.headingLevels === 'no-skip') && !title) wanted = Math.min(wanted, previous + 1)
      if (wanted !== current && may(line)) set(line, line.text.replace(/^#{1,6}/, '#'.repeat(wanted)), 'headingLevels')
      previous = level(line.text)
      firstHeading = false
    }
    if (line.kind === 'list' && profile.listMarker !== 'leave' && may(line)) {
      set(
        line,
        line.text.replace(BULLET, (_m, indent: string, _marker: string, space: string) => `${indent}${profile.listMarker}${space}`),
        'listMarker',
      )
    }
    if (profile.linkForm !== 'leave' && ctx.links !== undefined && line.kind !== 'code' && may(line))
      set(line, convertLinks(line.text, profile.linkForm, ctx.links), 'linkForm')
  }

  // Blank lines between blocks.
  const out: Line[] = []
  let gap: Line[] = []
  let prev: Line | null = null
  for (const line of lines) {
    if (line.kind === 'blank') {
      gap.push(line)
      continue
    }
    if (prev !== null && !(prev.kind === 'code' && line.kind === 'code')) {
      let want = gap.length
      let rule: RuleKey | null = null
      if (line.kind === 'heading' && profile.headingBlankBefore === 'one') [want, rule] = [1, 'headingBlankBefore']
      else if (prev.kind === 'heading' && profile.headingBlankAfter !== 'leave')
        [want, rule] = [profile.headingBlankAfter === 'one' ? 1 : 0, 'headingBlankAfter']
      else if (prev.kind === 'para' && line.kind === 'para' && gap.length > 0 && profile.paragraphBlankLines === 'one')
        [want, rule] = [1, 'paragraphBlankLines']
      if (profile.maxBlankLines !== 'leave' && want > Number(profile.maxBlankLines))
        [want, rule] = [Number(profile.maxBlankLines), rule ?? 'maxBlankLines']
      if (want !== gap.length && rule !== null && (may(line) || may(prev) || gap.some(may))) {
        gap =
          want < gap.length
            ? gap.slice(0, want)
            : [...gap, ...Array.from({ length: want - gap.length }, (): Line => ({ text: '', id: null, kind: 'blank' }))]
        applied.add(rule)
      }
    }
    out.push(...gap, line)
    gap = []
    prev = line
  }
  out.push(...gap)

  return { text: [...head, ...out.map((l) => l.text)].join('\n'), applied: RULES.map((r) => r.key).filter((k) => applied.has(k)) }
}

const leavesAll = (profile: FormattingProfile): boolean => RULES.every((r) => profile[r.key] === 'leave')

/**
 * Format what an AI proposes: `after` is the whole proposed note, `before`
 * the note as it is (null for a new note). Only lines the AI added or
 * changed, and the blank lines beside them, are edited.
 */
export function formatChanged(before: string | null, after: string, profile: FormattingProfile, ctx: FormatContext): FormatResult {
  if (leavesAll(profile)) return { text: after, applied: [] }
  if (before === null) return formatText(after, profile, ctx)
  const changed = changedLines(before.split('\n'), after.split('\n'))
  if (changed.size === 0) return { text: after, applied: [] }
  return formatText(after, profile, ctx, (id) => changed.has(id))
}

// ---------------------------------------------------------------------------
// Detecting habits

/** A majority this large pre-fills a rule; less is "mixed" and leaves it. */
export const MAJORITY = 0.8
/** Fewer examples than this say nothing either way. */
export const MIN_SAMPLES = 5

export type Finding = {
  rule: RuleKey
  value: string
  /** Where the value came from: the person's notes, or Obsidian Linter's settings. */
  source: 'habit' | 'linter' | 'none'
  text: string
}

type Tally = Map<string, number>
const bump = (t: Tally, key: string): void => void t.set(key, (t.get(key) ?? 0) + 1)
const pct = (n: number, total: number): string => `${Math.round((n / total) * 100)}%`

/** The value most examples agree on, when they agree enough. */
function verdict(t: Tally): { value: string; share: number; total: number } | null {
  const total = [...t.values()].reduce((a, b) => a + b, 0)
  if (total < MIN_SAMPLES) return null
  const [value, n] = [...t.entries()].sort((a, b) => b[1] - a[1])[0]!
  return { value, share: n / total, total }
}

export type NoteSample = { name: string; text: string }

/**
 * Count the habits in these notes, rule by rule: a value at least MAJORITY of
 * the examples agree on is pre-filled, anything less is "Leave as written".
 */
export function detectHabits(notes: readonly NoteSample[]): { profile: FormattingProfile; findings: Finding[] } {
  const before: Tally = new Map()
  const after: Tally = new Map()
  const levels: Tally = new Map()
  const title: Tally = new Map()
  const paragraphs: Tally = new Map()
  const maxRun: Tally = new Map()
  const markers: Tally = new Map()
  const links: Tally = new Map()

  for (const note of notes) {
    const all = note.text.split(/\r?\n/)
    const lines = readLines(all, frontmatterClose(all) + 1)
    const blocks: { line: Line; gap: number }[] = []
    let gap = 0
    let longest = 0
    for (const line of lines) {
      if (line.kind === 'blank') {
        gap++
        continue
      }
      if (blocks.length > 0) longest = Math.max(longest, gap)
      blocks.push({ line, gap })
      gap = 0
      if (line.kind === 'list') {
        const marker = BULLET.exec(line.text)?.[2]
        if (marker !== undefined) bump(markers, marker)
      }
      if (line.kind !== 'code') {
        for (const _ of line.text.matchAll(WIKI_LINK)) bump(links, 'wiki')
        for (const _ of line.text.matchAll(MD_LINK)) bump(links, 'markdown')
      }
    }
    if (blocks.length === 0) continue
    bump(maxRun, String(Math.min(longest, 3)))
    const top = blocks[0]!.line
    bump(title, top.kind === 'heading' && level(top.text) === 1 && sameName(headingText(top.text), note.name) ? 'always' : 'never')
    let skips = false
    let h1 = false
    let prevLevel = 0
    blocks.forEach(({ line, gap: g }, i) => {
      const prev = blocks[i - 1]?.line
      if (line.kind === 'heading') {
        const l = level(line.text)
        if (l === 1 && !(i === 0 && sameName(headingText(line.text), note.name))) h1 = true
        if (prevLevel !== 0 && l > prevLevel + 1) skips = true
        prevLevel = l
        if (i > 0) bump(before, g === 1 ? 'one' : String(g))
      }
      if (prev?.kind === 'heading' && line.kind !== 'heading') bump(after, g === 1 ? 'one' : g === 0 ? 'none' : String(g))
      if (prev?.kind === 'para' && line.kind === 'para' && g > 0) bump(paragraphs, g === 1 ? 'one' : String(g))
    })
    if (prevLevel !== 0) bump(levels, skips ? 'skips' : h1 ? 'no-skip' : 'no-skip-h2')
  }

  const profile = { ...LEAVE_ALL } as Record<RuleKey, string>
  const findings: Finding[] = []
  const decide = (rule: RuleKey, tally: Tally, describe: (value: string, share: string) => string, allowed: readonly string[]): void => {
    const v = verdict(tally)
    if (v === null) {
      findings.push({ rule, value: 'leave', source: 'none', text: 'Not enough examples to tell.' })
      return
    }
    const clear = v.share >= MAJORITY && allowed.includes(v.value)
    if (clear) profile[rule] = v.value
    const text = describe(v.value, pct(v.share * v.total, v.total))
    findings.push({ rule, value: clear ? v.value : 'leave', source: clear ? 'habit' : 'none', text: clear ? text : `Mixed: ${text}` })
  }

  decide(
    'headingBlankBefore',
    before,
    (v, p) => (v === 'one' ? `before ${p} of headings there's one blank line` : `before ${p} of headings there are ${v} blank lines`),
    ['one'],
  )
  decide(
    'headingBlankAfter',
    after,
    (v, p) =>
      v === 'none'
        ? `after ${p} of headings there's no blank line`
        : v === 'one'
          ? `after ${p} of headings there's one blank line`
          : `after ${p} of headings there are ${v} blank lines`,
    ['one', 'none'],
  )
  // Notes with headings: "no skipped levels" holds for those that start at H2 too.
  const noSkip = (levels.get('no-skip') ?? 0) + (levels.get('no-skip-h2') ?? 0)
  const levelTally: Tally = new Map([
    ['skips', levels.get('skips') ?? 0],
    [(levels.get('no-skip-h2') ?? 0) / Math.max(1, noSkip) >= MAJORITY ? 'no-skip-h2' : 'no-skip', noSkip],
  ])
  decide(
    'headingLevels',
    levelTally,
    (v, p) =>
      v === 'skips'
        ? `${p} of notes skip a heading level`
        : v === 'no-skip-h2'
          ? `${p} of notes never skip a level and start at H2`
          : `${p} of notes never skip a heading level`,
    ['no-skip', 'no-skip-h2'],
  )
  decide(
    'titleHeading',
    title,
    (v, p) => (v === 'always' ? `${p} of notes start with “# <note name>”` : `${p} of notes have no title heading`),
    ['always', 'never'],
  )
  decide(
    'paragraphBlankLines',
    paragraphs,
    (v, p) => (v === 'one' ? `between ${p} of paragraphs there's one blank line` : `between ${p} of paragraphs there are ${v} blank lines`),
    ['one'],
  )
  const runs: Tally = new Map([
    ['1', (maxRun.get('0') ?? 0) + (maxRun.get('1') ?? 0)],
    ['2', maxRun.get('2') ?? 0],
    ['3+', maxRun.get('3') ?? 0],
  ])
  decide(
    'maxBlankLines',
    runs,
    (v, p) =>
      v === '3+'
        ? `${p} of notes have 3 or more blank lines in a row`
        : `${p} of notes never have more than ${v} blank line${v === '1' ? '' : 's'} in a row`,
    ['1', '2'],
  )
  decide('listMarker', markers, (v, p) => `${p} of list items use “${v}”`, ['-', '*', '+'])
  decide('linkForm', links, (v, p) => (v === 'wiki' ? `${p} of links are [[wiki links]]` : `${p} of links are [text](path.md)`), [
    'wiki',
    'markdown',
  ])

  return { profile: profile as FormattingProfile, findings }
}

// ---------------------------------------------------------------------------
// Obsidian Linter

/** Linter's id in `.obsidian/community-plugins.json`. */
export const LINTER_ID = 'obsidian-linter'

/**
 * The rules Linter's settings decide, read from its `data.json` - only when
 * the plugin is enabled, and only rules switched on there. A Linter option
 * Recto has no value for imports nothing (its rule is left to the habits).
 */
export function fromLinter(enabledPlugins: unknown, data: unknown): Partial<FormattingProfile> | null {
  if (!Array.isArray(enabledPlugins) || !enabledPlugins.includes(LINTER_ID)) return null
  const configs = (data as { ruleConfigs?: Record<string, Record<string, unknown>> } | null)?.ruleConfigs
  if (configs === undefined || configs === null || typeof configs !== 'object') return {}
  const on = (rule: string): Record<string, unknown> | null => (configs[rule]?.['enabled'] === true ? configs[rule]! : null)
  const out: Partial<FormattingProfile> = {}
  const headings = on('heading-blank-lines')
  if (headings !== null) {
    out.headingBlankBefore = 'one'
    // "bottom" off means Linter adds none after, not that it removes them: left to the habits.
    if (headings['bottom'] !== false) out.headingBlankAfter = 'one'
  }
  const increment = on('header-increment')
  if (increment !== null) out.headingLevels = increment['start-at-h2'] === true ? 'no-skip-h2' : 'no-skip'
  if (on('file-name-heading') !== null) out.titleHeading = 'always'
  if (on('paragraph-blank-lines') !== null) out.paragraphBlankLines = 'one'
  if (on('consecutive-blank-lines') !== null) out.maxBlankLines = '1'
  const lists = on('unordered-list-style')
  const style = lists?.['list-style']
  if (style === '-' || style === '*' || style === '+') out.listMarker = style
  return out
}

/** Linter's settings first, then the habits for every rule Linter did not decide. */
export function detectProfile(
  notes: readonly NoteSample[],
  linter: Partial<FormattingProfile> | null,
): { profile: FormattingProfile; findings: Finding[] } {
  const habits = detectHabits(notes)
  if (linter === null) return habits
  const profile = { ...habits.profile, ...linter }
  const findings = habits.findings.map((f): Finding => {
    const value = linter[f.rule]
    if (value === undefined) return f
    const rule = RULES.find((r) => r.key === f.rule)!
    return { rule: f.rule, value, source: 'linter', text: `Imported from Obsidian Linter (${rule.linter ?? ''}).` }
  })
  return { profile, findings }
}
