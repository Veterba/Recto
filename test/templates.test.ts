import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMPLATE_SETTINGS,
  coerceTemplateSettings,
  dailyNotePath,
  fillTemplate,
  isInFolder,
  isoWeek,
  mergeTemplateProperties,
  normaliseFolder,
  templateBody,
  templateName,
} from '../src/renderer/core/templates'

const now = new Date('2026-09-13T14:05:00')
const vars = { title: 'Weekly review', path: 'work/weekly review.md', now }

describe('placeholders', () => {
  it('fills the ones it knows', () => {
    expect(fillTemplate('# {{title}}\n{{date}} at {{time}}\n{{path}}', vars)).toBe(
      '# Weekly review\n2026-09-13 at 14:05\nwork/weekly review.md',
    )
  })

  it('shifts a date by days, for follow-ups and daily notes', () => {
    expect(fillTemplate('due {{date:+7}}, from {{date:-1}}', vars)).toBe('due 2026-09-20, from 2026-09-12')
  })

  it('crosses a month boundary correctly', () => {
    expect(fillTemplate('{{date:+20}}', vars)).toBe('2026-10-03')
  })

  it('leaves an unknown placeholder exactly as written', () => {
    // Replacing it with nothing looks like the template was wrong; leaving the
    // literal text shows you what to fix.
    expect(fillTemplate('Attendees: {{attendees}}', vars)).toBe('Attendees: {{attendees}}')
  })

  it('tolerates spacing and case', () => {
    expect(fillTemplate('{{ DATE }} {{Title}}', vars)).toBe('2026-09-13 Weekly review')
  })

  it('uses one instant for every placeholder in an insert', () => {
    const out = fillTemplate('{{time}} {{time}}', vars)
    const [a, b] = out.split(' ')
    expect(a).toBe(b)
  })

  it('leaves text with no placeholders alone', () => {
    expect(fillTemplate('nothing here', vars)).toBe('nothing here')
  })
})

describe('template body', () => {
  it('drops the template’s own frontmatter', () => {
    // Pasting it mid-note would produce a second `---` block, which markdown
    // reads as a rule and a pile of stray text.
    const text = '---\ntitle: Meeting\ntags: [work]\n---\n\n# {{title}}\n\nNotes\n'
    expect(templateBody(text)).toBe('# {{title}}\n\nNotes\n')
  })

  it('leaves a template with no frontmatter untouched', () => {
    expect(templateBody('# Heading\n\nbody')).toBe('# Heading\n\nbody')
  })

  it('does not mistake a horizontal rule for frontmatter', () => {
    const text = 'intro\n\n---\n\nmore'
    expect(templateBody(text)).toBe(text)
  })

  it('leaves an unterminated block alone rather than eating the file', () => {
    expect(templateBody('---\ntitle: broken\n\nbody')).toBe('---\ntitle: broken\n\nbody')
  })
})

describe('template names', () => {
  it('is the file name without folder or extension', () => {
    expect(templateName('templates/meeting notes.md')).toBe('meeting notes')
  })
})

describe('normaliseFolder', () => {
  it('tidies what people type', () => {
    expect(normaliseFolder('  /Templates/ ')).toBe('Templates')
    expect(normaliseFolder('work//templates')).toBe('work/templates')
    expect(normaliseFolder('work\\templates')).toBe('work/templates')
  })

  it('refuses a way out of the vault', () => {
    expect(normaliseFolder('../elsewhere')).toBe(null)
    expect(normaliseFolder('a/../../b')).toBe(null)
  })

  /** A hidden folder is one the tree never shows: you would set it and lose it. */
  it('refuses hidden folders', () => {
    expect(normaliseFolder('.recto/templates')).toBe(null)
    expect(normaliseFolder('notes/.hidden')).toBe(null)
  })

  it('refuses nothing at all', () => {
    expect(normaliseFolder('   ')).toBe(null)
    expect(normaliseFolder('/')).toBe(null)
  })
})

describe('coerceTemplateSettings', () => {
  it('defaults on rubbish', () => {
    expect(coerceTemplateSettings(null)).toEqual(DEFAULT_TEMPLATE_SETTINGS)
    expect(coerceTemplateSettings('x')).toEqual(DEFAULT_TEMPLATE_SETTINGS)
  })

  it('keeps the good fields and replaces only the bad ones', () => {
    expect(
      coerceTemplateSettings({ folder: '../nope', daily: { enabled: true, folder: 'Journal', template: 'templates/day.md' } }),
    ).toEqual({ folder: 'templates', daily: { enabled: true, folder: 'Journal', template: 'templates/day.md' } })
  })

  it('only switches the daily note on for a real true', () => {
    expect(coerceTemplateSettings({ daily: { enabled: 'yes' } }).daily.enabled).toBe(false)
  })

  it('drops a template path that is not a note', () => {
    expect(coerceTemplateSettings({ daily: { template: 'templates/day.txt' } }).daily.template).toBe(null)
    expect(coerceTemplateSettings({ daily: { template: '../day.md' } }).daily.template).toBe(null)
  })
})

describe('isInFolder', () => {
  it('matches by segment, not by prefix', () => {
    expect(isInFolder('templates/day.md', 'templates')).toBe(true)
    expect(isInFolder('templates', 'templates')).toBe(true)
    // The classic prefix bug: this is a different folder.
    expect(isInFolder('templates-old/day.md', 'templates')).toBe(false)
  })
})

describe('isoWeek', () => {
  it('numbers an ordinary week', () => {
    expect(isoWeek(new Date(2026, 8, 14))).toEqual({ year: 2026, week: 38 })
  })

  it('starts weeks on Monday', () => {
    // Sunday 13 Sep 2026 and Monday 14 Sep 2026 are in different weeks.
    expect(isoWeek(new Date(2026, 8, 13)).week).toBe(37)
    expect(isoWeek(new Date(2026, 8, 14)).week).toBe(38)
  })

  /** The edges are the whole reason this is not `Math.ceil(dayOfYear / 7)`. */
  it('puts late December into week 1 of the next year when ISO says so', () => {
    expect(isoWeek(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 })
  })

  it('puts early January into the last week of the previous year when ISO says so', () => {
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ year: 2026, week: 53 })
  })
})

describe('dailyNotePath', () => {
  it('files a day under year, month and week', () => {
    expect(dailyNotePath(new Date(2026, 8, 14, 9, 30), 'Daily')).toEqual({
      folder: 'Daily/2026/09/W38',
      name: '2026-09-14.md',
      path: 'Daily/2026/09/W38/2026-09-14.md',
      key: '2026-09-14',
    })
  })

  /** A December note belongs in December, even when its ISO week is next year's. */
  it('keeps the calendar year and month at a year boundary', () => {
    expect(dailyNotePath(new Date(2025, 11, 29), 'Daily').folder).toBe('Daily/2025/12/W01')
  })

  it('names the note with the full date, so links are never ambiguous', () => {
    expect(dailyNotePath(new Date(2026, 0, 5), 'Journal').name).toBe('2026-01-05.md')
  })

  it('uses the configured root', () => {
    expect(dailyNotePath(new Date(2026, 8, 14), 'life/journal').path.startsWith('life/journal/2026/')).toBe(true)
  })
})

describe('mergeTemplateProperties', () => {
  const template = '---\ntags:\n  - meeting\nattendees: \nwhen: 2026-09-17\n---\n\n## Agenda\n'

  it('adds the template’s properties to a note that has none', () => {
    const merged = mergeTemplateProperties('# Note\n\nbody\n', template)
    expect(merged.startsWith('---\n')).toBe(true)
    expect(merged).toContain('attendees:')
    expect(merged).toContain('when: 2026-09-17')
    expect(merged).toContain('# Note')
  })

  it('never overwrites a property the note already has', () => {
    const note = '---\ntags:\n  - note\n---\n\n# Note\n'
    const merged = mergeTemplateProperties(note, template)
    expect(merged).toContain('- note')
    expect(merged).not.toContain('- meeting')
    expect(merged).toContain('attendees:')
  })

  it('leaves a note alone when the template has no properties', () => {
    const note = '# Note\n\nbody\n'
    expect(mergeTemplateProperties(note, '## Agenda\n')).toBe(note)
  })
})
