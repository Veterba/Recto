import { describe, expect, it } from 'vitest'
import { asksAboutLinks, linkStatus, linkStatusText } from '../../../src/main/bots/links'

describe('link_status', () => {
  const vault = ['Garden/Soil.md', 'Running plan.md', 'Projects/Recto/Plan.md']

  it('lists each link and whether its note exists, headings and aliases ignored', () => {
    const note = 'See [[Soil]], [[Running plan#Goals|my plan]], [[Projects/Recto/Plan]] and [[Ghost note]].\n```\n[[in code]]\n```'
    expect(linkStatus(note, vault).map((l) => [l.target, l.exists])).toEqual([
      ['Soil', true],
      ['Running plan', true],
      ['Projects/Recto/Plan', true],
      ['Ghost note', false],
    ])
  })

  it('says it plainly for the model', () => {
    const text = linkStatusText('Plans', linkStatus('[[Soil]] [[Ghost note]]', vault))
    expect(text).toBe('Links in "Plans": 2, 1 to notes that don\'t exist.\n- [[Soil]] - exists\n- [[Ghost note]] - no such note')
    expect(linkStatusText('Empty', [])).toBe('"Empty" has no [[links]].')
  })

  it('knows a question about links, in Russian, English and Norwegian', () => {
    for (const q of ['Какие ссылки в заметке «Планы» битые?', 'Do the links in my Plan note work?', 'Hvilke lenker i notatet finnes ikke?'])
      expect(asksAboutLinks(q), q).toBe(true)
    expect(asksAboutLinks('What is in my Plan note?')).toBe(false)
  })
})
