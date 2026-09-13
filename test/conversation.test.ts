import { describe, expect, it } from 'vitest'
import {
  chatFileName,
  parseConversation,
  serialiseConversation,
  titleFrom,
} from '../src/renderer/ai/conversation'
import { splitBlocks } from '../src/renderer/ai/Markdownish'

/**
 * A conversation is a note, so the only thing that has to hold is that the note
 * and the transcript are the same object seen twice.
 */
describe('conversation format', () => {
  const sample = {
    title: 'How do wikilinks work',
    model: 'claude-sonnet-5',
    messages: [
      { role: 'user' as const, content: 'How do wikilinks work?' },
      { role: 'assistant' as const, content: 'You write `[[Note name]]`.' },
    ],
  }

  it('round-trips', () => {
    expect(parseConversation(serialiseConversation(sample))).toEqual(sample)
  })

  it('writes a transcript a person can read', () => {
    const text = serialiseConversation(sample)
    expect(text).toContain('## You')
    expect(text).toContain('## Claude')
    expect(text).toContain('# How do wikilinks work')
    expect(text).not.toContain('{')
  })

  it('keeps the model in frontmatter', () => {
    expect(parseConversation(serialiseConversation(sample)).model).toBe('claude-sonnet-5')
  })

  /**
   * The one that would silently corrupt history: a reply containing a code
   * block that itself contains `## You` must not be split at it.
   */
  it('does not split on a heading inside a code fence', () => {
    const reply = ['Here is the format:', '', '```markdown', '## You', 'a question', '```', '', 'That is all.'].join('\n')
    const parsed = parseConversation(
      serialiseConversation({ ...sample, messages: [{ role: 'user', content: 'show me' }, { role: 'assistant', content: reply }] }),
    )
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[1]?.content).toBe(reply)
  })

  it('reads a note somebody wrote by hand', () => {
    const parsed = parseConversation(['# Chat', '', '## You', '', 'hi', '', '## Claude', '', 'hello'].join('\n'))
    expect(parsed.title).toBe('Chat')
    expect(parsed.model).toBe(null)
    expect(parsed.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('survives an empty note', () => {
    expect(parseConversation('')).toEqual({ title: '', model: null, messages: [] })
  })

  it('drops empty turns rather than sending blanks to the API', () => {
    const parsed = parseConversation(['## You', '', '   ', '', '## Claude', '', 'hello'].join('\n'))
    expect(parsed.messages).toEqual([{ role: 'assistant', content: 'hello' }])
  })
})

describe('titleFrom', () => {
  it('uses the first line of the first question', () => {
    expect(titleFrom([{ role: 'user', content: 'Why is the sky blue?\nAsking for a friend.' }])).toBe(
      'Why is the sky blue?',
    )
  })

  it('clips a long one', () => {
    const title = titleFrom([{ role: 'user', content: 'x'.repeat(200) }])
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith('…')).toBe(true)
  })

  it('strips markdown, because the title becomes a heading', () => {
    expect(titleFrom([{ role: 'user', content: '## **fix** the `parser`' }])).toBe('fix the parser')
  })

  it('falls back when there is nothing to go on', () => {
    expect(titleFrom([])).toBe('New chat')
    expect(titleFrom([{ role: 'user', content: '   ' }])).toBe('New chat')
  })
})

describe('chatFileName', () => {
  it('sorts by time and needs no renaming later', () => {
    expect(chatFileName(new Date(2026, 8, 13, 20, 31, 5))).toBe('2026-09-13 20-31-05.md')
  })
})

describe('splitBlocks', () => {
  it('separates fenced code from prose', () => {
    const blocks = splitBlocks(['Here:', '', '```ts', 'const x = 1', '```', '', 'Done.'].join('\n'))
    expect(blocks).toEqual([
      { kind: 'text', text: 'Here:' },
      { kind: 'code', lang: 'ts', code: 'const x = 1' },
      { kind: 'text', text: 'Done.' },
    ])
  })

  /**
   * Every streamed answer looks like this for as long as a code block is being
   * written, so the half-open case is the common case, not the edge one.
   */
  it('renders a half-streamed fence as code', () => {
    expect(splitBlocks('Try:\n\n```js\nconst a =')).toEqual([
      { kind: 'text', text: 'Try:' },
      { kind: 'code', lang: 'js', code: 'const a =' },
    ])
  })

  it('leaves plain prose as one block', () => {
    expect(splitBlocks('just words')).toEqual([{ kind: 'text', text: 'just words' }])
  })

  it('is empty for empty text', () => {
    expect(splitBlocks('')).toEqual([])
  })
})
