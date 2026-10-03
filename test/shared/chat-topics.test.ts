import { describe, expect, it } from 'vitest'
import { appendTurns, createdStamp, metaComment, parseTopic, topicFile, topicFileName } from '../../src/shared/chat-topics'
import type { BotMessage } from '../../src/shared/bots'

const answer: BotMessage = {
  role: 'assistant',
  content: 'Compost, loam and grit.',
  at: '2026-10-02T15:30:12',
  model: 'qwen3.5:9b',
  sources: [{ path: 'Garden/Soil.md', heading: 'Mix' }],
  steps: [{ action: 'Searching notes', result: '“Soil -- mix”', state: 'done' }],
  ttftMs: 812,
  totalMs: 2400,
}

describe('message meta', () => {
  it('round-trips every field through one comment after the message', () => {
    const body = appendTurns('', [{ role: 'user', content: 'What goes in the mix?', at: '2026-10-02T15:30:01' }, answer], 'Recto')
    expect(body.match(/<!-- recto:meta /g)).toHaveLength(2)
    const [question, reply] = parseTopic(body, ['Recto']).messages
    expect(question).toMatchObject({ role: 'user', content: 'What goes in the mix?', at: '2026-10-02T15:30:01' })
    const { label: _label, ...rest } = reply!
    expect(rest).toEqual(answer)
  })

  it('writes only the fields that exist, and nothing for a message with none', () => {
    expect(metaComment({ model: 'qwen3.5:9b', sources: [] })).toBe('<!-- recto:meta {"model":"qwen3.5:9b"} -->')
    expect(metaComment({})).toBe('')
    expect(appendTurns('', [{ role: 'user', content: 'hei' }], 'Recto')).toBe('## You\n\nhei\n')
  })

  it('still reads the older sources comment', () => {
    const body = '## Recto\n\nCompost.\n\n<!-- recto:sources [{"path":"Garden/Soil.md","heading":null}] -->\n'
    expect(parseTopic(body, ['Recto']).messages[0]).toMatchObject({
      content: 'Compost.',
      sources: [{ path: 'Garden/Soil.md', heading: null }],
    })
  })

  it('drops a malformed comment instead of failing', () => {
    const message = parseTopic('## Recto\n\nHi.\n\n<!-- recto:meta {not json -->\n', ['Recto']).messages[0]!
    expect(message.content).toBe('Hi.')
    expect(message.model).toBeUndefined()
  })
})

describe('topic files', () => {
  it('records when a topic began to the second; the file name stays at the minute', () => {
    const created = createdStamp(new Date('2026-10-02T15:30:12'))
    expect(created).toBe('2026-10-02T15:30:12')
    expect(topicFileName(created, 'Soil mix')).toBe('2026-10-02 15-30 — Soil mix.md')
    expect(parseTopic(topicFile({ bot: 'recto', created, title: 'Soil mix' }, [], ''), []).meta.created).toBe('2026-10-02T15:30:12')
  })
})
