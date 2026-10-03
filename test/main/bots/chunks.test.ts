import { describe, expect, it } from 'vitest'
import { chunkInput, chunkNote } from '../../../src/main/bots/chunks'

describe('chunkNote', () => {
  it('drops frontmatter and keeps a short note whole, bold lines as headings inside it', () => {
    const note = '---\ntopics: [a]\n---\n**Бюджет:**\n- 60k\n\n**Когда:**\n- март'
    const chunks = chunkNote('Japan trip', note)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.path).toEqual([])
    expect(chunks[0]!.text).toContain('**Бюджет**')
    expect(chunks[0]!.text).toContain('**Когда**')
    expect(chunks[0]!.text).not.toContain('topics')
  })

  it('keeps the heading path of a long section and cuts it with overlap', () => {
    const para = (n: number): string => `Paragraph ${n}. ${'word '.repeat(80).trim()}.`
    const note = ['# Plan', '## Graph', ...Array.from({ length: 8 }, (_, i) => `${para(i)}\n`)].join('\n')
    const chunks = chunkNote('Recto plan', note)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) {
      expect(c.path).toEqual(['Plan', 'Graph'])
      expect(c.text.length).toBeLessThanOrEqual(1400)
    }
    // The next piece starts with the end of the one before.
    expect(chunks[1]!.text.startsWith(chunks[0]!.text.slice(-150).trim())).toBe(true)
  })

  it('does not read headings inside code fences', () => {
    const chunks = chunkNote('n', '```\n# not a heading\n```\ntext')
    expect(chunks.every((c) => c.path.length === 0)).toBe(true)
  })

  it('embeds title and heading path with the text', () => {
    expect(chunkInput('Recto plan', { path: ['Graph'], text: 'x' })).toBe('title: Recto plan > Graph | text: x')
    const a = chunkNote('A', '# H\ntext')[0]!.hash
    const b = chunkNote('B', '# H\ntext')[0]!.hash
    expect(a).not.toBe(b)
  })
})
