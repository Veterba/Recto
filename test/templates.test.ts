import { describe, expect, it } from 'vitest'
import { fillTemplate, templateBody, templateName } from '../src/renderer/core/templates'

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
