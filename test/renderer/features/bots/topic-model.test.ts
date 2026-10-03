import { beforeEach, describe, expect, it } from 'vitest'
import { IPC } from '../../../../src/shared/ipc'
import { ChatTopics } from '../../../../src/renderer/features/bots/chat-topics-model'

/** The topic model against an in-memory vault: what it writes is what the files hold. */
const files = new Map<string, string>()

beforeEach(() => {
  files.clear()
  ;(globalThis as { window?: unknown }).window = {
    api: {
      invoke: async (channel: string, ...args: string[]) => {
        if (channel === IPC.fsTree) return []
        if (channel === IPC.fsRead) {
          const content = files.get(args[0]!)
          return content === undefined ? { ok: false, error: 'missing' } : { ok: true, content }
        }
        if (channel === IPC.fsWrite) {
          files.set(args[0]!, args[1]!)
          return { ok: true }
        }
        if (channel === IPC.fsCreate) {
          const path = `${args[0]}/${args[1]}`
          files.set(path, '')
          return { ok: true, path }
        }
        return null
      },
      on: () => () => {},
    },
  }
})

async function topicWithAnswer(): Promise<{ model: ChatTopics; path: string }> {
  const model = new ChatTopics({ id: 'recto', name: 'Recto' }, ['Recto'])
  await model.refresh()
  const path = (await model.append({ role: 'user', content: 'What goes in the mix?' }))!
  await model.append({ role: 'assistant', content: 'Compost.', model: 'qwen3.5:9b' })
  return { model, path }
}

describe('appending turns', () => {
  it('every turn carries the time it was written, and an answer its meta', async () => {
    const { model, path } = await topicWithAnswer()
    const messages = model.loaded.get(path)!.messages
    expect(messages.every((m) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(m.at ?? ''))).toBe(true)
    expect(messages[1]).toMatchObject({ content: 'Compost.', model: 'qwen3.5:9b' })
    expect(files.get(path)).toContain('"model":"qwen3.5:9b"')
  })
})
