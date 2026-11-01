import { describe, expect, it } from 'vitest'
import {
  detectHabits,
  detectProfile,
  formatChanged,
  formatText,
  fromLinter,
  LEAVE_ALL,
  type FormattingProfile,
} from '../../src/shared/formatting'

/**
 * The formatting profile: what each rule does, that "Leave as written" does
 * nothing, that only the lines an AI wrote are touched, and that habits and
 * Linter's settings pre-fill the rules.
 */

const ctx = { name: 'Plan' }
const with_ = (patch: Partial<FormattingProfile>): FormattingProfile => ({ ...LEAVE_ALL, ...patch })
/** One blank line before headings, none after. */
const MINE = with_({ headingBlankBefore: 'one', headingBlankAfter: 'none' })

describe('formatText', () => {
  it('“Leave as written” everywhere changes nothing at all', () => {
    const text = '# Plan\n\n\n\nIntro\n## A\n\n* one\n+ two\n### Skipped\n[x](Garden/Basil.md)'
    expect(formatText(text, LEAVE_ALL, ctx)).toEqual({ text, applied: [] })
  })

  it('my style: one blank line before a heading, none after', () => {
    const text = 'Intro\n## A\n\nBody\n\n\n## B\nMore\n## C'
    expect(formatText(text, MINE, ctx).text).toBe('Intro\n\n## A\nBody\n\n## B\nMore\n\n## C')
  })

  it('my style round-trips: text already in it comes back unchanged', () => {
    const text = '# Plan\nIntro\n\n## A\nBody\n\n## B\n- one\n- two'
    expect(formatText(text, MINE, ctx)).toEqual({ text, applied: [] })
  })

  it('heading levels never skip; start at H2 turns a stray H1 into H2', () => {
    expect(formatText('## A\n#### B\n## C', with_({ headingLevels: 'no-skip' }), ctx).text).toBe('## A\n### B\n## C')
    expect(formatText('# Other\n### B', with_({ headingLevels: 'no-skip-h2' }), ctx).text).toBe('## Other\n### B')
  })

  it('a title heading is taken off, or put on', () => {
    expect(formatText('# Plan\n\nBody', with_({ titleHeading: 'never' }), ctx).text).toBe('Body')
    expect(formatText('Body', with_({ titleHeading: 'always' }), ctx).text).toBe('# Plan\n\nBody')
  })

  it('paragraphs, blank runs, list markers', () => {
    expect(formatText('A\n\n\nB', with_({ paragraphBlankLines: 'one' }), ctx).text).toBe('A\n\nB')
    expect(formatText('- a\n\n\n\n- b', with_({ maxBlankLines: '2' }), ctx).text).toBe('- a\n\n\n- b')
    expect(formatText('* a\n  + b\n1. c\n***', with_({ listMarker: '-' }), ctx).text).toBe('- a\n  - b\n1. c\n***')
  })

  it('link form, both ways, only for links that resolve', () => {
    const links = {
      toWiki: (p: string) => (p === 'Garden/Basil.md' ? 'Basil' : null),
      toPath: (t: string) => (t === 'Basil' ? 'Garden/Basil.md' : null),
    }
    expect(formatText('[Basil](Garden/Basil.md) [x](Nope.md)', with_({ linkForm: 'wiki' }), { name: 'P', links }).text).toBe(
      '[[Basil]] [x](Nope.md)',
    )
    expect(formatText('[[Basil|herb]] [[Nope]]', with_({ linkForm: 'markdown' }), { name: 'P', links }).text).toBe(
      '[herb](Garden/Basil.md) [[Nope]]',
    )
  })

  it('never touches frontmatter or a code block', () => {
    const text = '---\ntags: a\n---\nIntro\n```\n* x\n\n\n\n## not a heading\n```\n* y'
    expect(formatText(text, with_({ listMarker: '-', maxBlankLines: '1', headingBlankBefore: 'one' }), ctx).text).toBe(
      '---\ntags: a\n---\nIntro\n```\n* x\n\n\n\n## not a heading\n```\n- y',
    )
  })
})

describe('formatChanged', () => {
  it('touches only the lines the AI added or changed, and the blank lines beside them', () => {
    const before = 'Intro\n## Mine\n\nKept as I wrote it\n* my item'
    const after = 'Intro\n## Mine\n\nKept as I wrote it\n* my item\n## New\n\n* new item'
    const result = formatChanged(before, after, with_({ ...MINE, listMarker: '-' }), ctx)
    expect(result.text).toBe('Intro\n## Mine\n\nKept as I wrote it\n* my item\n\n## New\n- new item')
  })

  it('a new note is formatted whole; no change, no edit', () => {
    expect(formatChanged(null, 'Body\n## H\n\nx', MINE, ctx).text).toBe('Body\n\n## H\nx')
    expect(formatChanged('a\n## b', 'a\n## b', MINE, ctx)).toEqual({ text: 'a\n## b', applied: [] })
  })
})

describe('detecting habits', () => {
  const note = (body: string, name = 'N'): { name: string; text: string } => ({ name, text: body })
  const clear = Array.from({ length: 6 }, (_, i) => note(`Intro\n\n## H${i}\nBody\n\n## G\n- a\n- b\n[[X]]`))

  it('a clear habit (≥80%) pre-fills its rule, with the finding said', () => {
    const { profile, findings } = detectHabits(clear)
    expect(profile.headingBlankBefore).toBe('one')
    expect(profile.headingBlankAfter).toBe('none')
    expect(profile.listMarker).toBe('-')
    expect(profile.linkForm).toBe('wiki')
    expect(findings.find((f) => f.rule === 'headingBlankAfter')?.text).toBe("after 100% of headings there's no blank line")
  })

  it('mixed habits leave the rule as written', () => {
    const mixed = [...clear.slice(0, 3), ...Array.from({ length: 3 }, () => note('Intro\n## H\n\nBody\n* a'))]
    const { profile, findings } = detectHabits(mixed)
    expect(profile.headingBlankAfter).toBe('leave')
    expect(findings.find((f) => f.rule === 'headingBlankAfter')?.text).toMatch(/^Mixed: /)
  })

  it('an empty vault leaves everything', () => {
    expect(detectHabits([]).profile).toEqual(LEAVE_ALL)
  })

  it('Linter: read only when enabled, and its settings win over habits', () => {
    const data = {
      ruleConfigs: {
        'heading-blank-lines': { enabled: true, bottom: true },
        'unordered-list-style': { enabled: true, 'list-style': '*' },
        'header-increment': { enabled: false },
      },
    }
    expect(fromLinter(['other'], data)).toBeNull()
    const linter = fromLinter(['obsidian-linter'], data)
    expect(linter).toEqual({ headingBlankBefore: 'one', headingBlankAfter: 'one', listMarker: '*' })
    const { profile, findings } = detectProfile(clear, linter)
    expect(profile.headingBlankAfter).toBe('one')
    expect(profile.listMarker).toBe('*')
    expect(profile.linkForm).toBe('wiki')
    expect(findings.find((f) => f.rule === 'listMarker')?.source).toBe('linter')
  })
})
