import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSystem,
  fitHistory,
  isExcluded,
  queryTerms,
  rankNotes,
  scoreSection,
  selectChunks,
  splitSections,
} from '../../../src/main/bots/context'
import { RECTO_SYSTEM, listBots, readBot } from '../../../src/main/bots/definitions'
import { hasModel, readLines } from '../../../src/main/bots/provider'
import { RECTO } from '../../../src/shared/bot-presets'

describe('query terms', () => {
  it('keeps the words that say what is asked, in English and Russian', () => {
    expect(queryTerms('What did I decide about topics naming?')).toEqual(['decide', 'topics', 'naming'])
    expect(queryTerms('Что я решил про названия тем?')).toEqual(['решил', 'назван'])
  })

  it('cuts long words back to a stem, so prefix search finds their other forms', () => {
    expect(queryTerms('refactoring')).toEqual(['refactori'])
    expect(queryTerms('заметках')).toEqual(['заметк'])
  })

  it('drops repeats and stops at the maximum', () => {
    expect(queryTerms('soil soil soil')).toEqual(['soil'])
    expect(queryTerms('one two three four five six seven eight nine ten eleven', 3)).toEqual(['one', 'two', 'three'])
  })
})

describe('small talk', () => {
  it('has no words worth searching for', () => {
    for (const message of ['hei', 'Hi!', 'hello there', 'thanks', 'ok', 'привет', 'спасибо!', 'Доброе утро'])
      expect(queryTerms(message)).toEqual([])
  })

  it('a short word only counts as a whole word, a longer one from the start of a word', () => {
    expect(scoreSection({ heading: null, text: 'The height of the bed' }, ['hei'])).toBe(0)
    expect(scoreSection({ heading: null, text: 'hei og hå' }, ['hei'])).toBeGreaterThan(0)
    expect(scoreSection({ heading: null, text: 'I decided to wait' }, ['decid'])).toBeGreaterThan(0)
    expect(scoreSection({ heading: null, text: 'still undecided' }, ['decid'])).toBe(0)
    expect(scoreSection({ heading: null, text: 'Заметки о почве' }, ['заметк'])).toBeGreaterThan(0)
  })

  it('a question of two or more words needs two of them in a section, not one by chance', () => {
    const log = { path: 'log.md', title: 'Log', score: 1, sections: [{ heading: null, text: 'Capitalise the first letter.' }] }
    expect(selectChunks([log], queryTerms('what is the capital of France?'))).toEqual([])
    expect(selectChunks([log], queryTerms('capitalise'))).toHaveLength(1)
  })

  it('a word only in a heading is not enough to be read', () => {
    expect(selectChunks([{ path: 'a.md', title: 'A', score: 1, sections: [{ heading: 'Soil', text: 'nothing here' }] }], ['soil'])).toEqual(
      [],
    )
  })
})

describe('ranking notes', () => {
  it('ranks by how many of the question words a note has, then how high it came up', () => {
    const ranked = rankNotes(
      [
        [{ path: 'a.md' }, { path: 'b.md' }],
        [{ path: 'b.md' }, { path: 'c.md' }],
      ],
      [],
    )
    expect(ranked.map((n) => n.path)).toEqual(['b.md', 'a.md', 'c.md'])
  })

  it('never returns a note in an excluded folder', () => {
    const ranked = rankNotes([[{ path: 'chats/recto/x.md' }, { path: 'Journal/day.md' }, { path: 'Ideas.md' }]], ['chats', 'journal'])
    expect(ranked.map((n) => n.path)).toEqual(['Ideas.md'])
  })

  it('excludes by whole folder names only', () => {
    expect(isExcluded('chats/a.md', ['chats'])).toBe(true)
    expect(isExcluded('chatsy/a.md', ['chats'])).toBe(false)
    expect(isExcluded('Work/Secret/a.md', ['work/secret/'])).toBe(true)
  })
})

describe('sections', () => {
  const note = `---
tags: [x]
---
# Title

Intro line.

## Naming

Call it topics.

\`\`\`md
## not a heading
\`\`\`

## Later

Something else.
`

  it('splits at headings, drops frontmatter, and keeps fenced headings as text', () => {
    const sections = splitSections(note)
    expect(sections.map((s) => s.heading)).toEqual(['Title', 'Naming', 'Later'])
    expect(sections[1]!.text).toContain('## not a heading')
    expect(sections.some((s) => s.text.includes('tags:'))).toBe(false)
  })

  it('cuts a long section into pieces that keep its heading', () => {
    const long = `## Long\n\n${Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${'x'.repeat(300)}`).join('\n\n')}`
    const sections = splitSections(long)
    expect(sections.length).toBeGreaterThan(1)
    expect(sections.every((s) => s.heading === 'Long' && s.text.length <= 1200 + 320)).toBe(true)
  })

  it('weighs a term in the text above one only in the heading', () => {
    expect(scoreSection({ heading: 'Other', text: 'about topics' }, ['topics'])).toBeGreaterThan(
      scoreSection({ heading: 'Topics', text: 'nothing' }, ['topics']),
    )
    expect(scoreSection({ heading: 'Topics', text: 'topics' }, ['topics'])).toBeGreaterThan(
      scoreSection({ heading: null, text: 'topics' }, ['topics']),
    )
    expect(scoreSection({ heading: null, text: 'nothing here' }, ['topics'])).toBe(0)
  })
})

describe('choosing chunks', () => {
  const notes = [
    {
      path: 'Decisions.md',
      title: 'Decisions',
      score: 2.5,
      sections: [
        { heading: 'Naming', text: 'Topics naming: call the feature topics.' },
        { heading: 'Topics UI', text: 'topics naming in the sidebar' },
        { heading: 'Topics more', text: 'topics naming again' },
      ],
    },
    { path: 'Other.md', title: 'Other', score: 1.2, sections: [{ heading: null, text: 'unrelated text' }] },
  ]

  it('takes from one note its opening and its two best other sections, the best first', () => {
    const chunks = selectChunks(notes, ['topics', 'naming'])
    expect(chunks.filter((c) => c.path === 'Decisions.md')).toHaveLength(3)
    expect(chunks[0]).toMatchObject({ path: 'Decisions.md', heading: 'Naming' })
  })

  it("prefers a note's opening section when it matches as well as a later one", () => {
    const log = {
      path: 'log.md',
      title: 'Log',
      score: 1,
      sections: [
        { heading: 'Phase 6', text: 'The feature is now called topics everywhere.' },
        { heading: 'Topics run', text: 'topics ran on the fixture.' },
      ],
    }
    expect(selectChunks([log], ['topics'], { max: 1 })[0]!.heading).toBe('Phase 6')
    // Even when a later section mentions the words more often.
    const busier = { ...log, sections: [log.sections[0]!, { heading: 'Topics run', text: 'topics topics topics topics topics' }] }
    expect(selectChunks([busier], ['topics']).map((c) => c.heading)).toContain('Phase 6')
  })

  it('takes nothing from a note that matched only by its title', () => {
    expect(selectChunks(notes, ['topics']).some((c) => c.path === 'Other.md')).toBe(false)
  })

  it('stays within the budget and the maximum', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      path: `n${i}.md`,
      title: `n${i}`,
      score: 1,
      sections: [{ heading: null, text: `soil ${'y'.repeat(900)}` }],
    }))
    const chunks = selectChunks(many, ['soil'], { max: 6, budget: 3000 })
    expect(chunks.length).toBeLessThanOrEqual(6)
    expect(chunks.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(3000)
  })

  it('gives small talk no notes at all, and says so when a real question matched nothing', () => {
    expect(buildSystem('Be brief.', null)).toBe('Be brief.')
  })

  it('tells the model plainly when nothing matched', () => {
    expect(buildSystem('Be brief.', [])).toContain('No notes in the vault matched this question.')
    expect(buildSystem('Be brief.', [{ path: 'a.md', heading: 'H', title: 'A', text: 'body' }])).toContain('### A (a.md › H)\nbody')
  })
})

describe('history', () => {
  const msg = (role: 'user' | 'assistant', n: number): { role: 'user' | 'assistant'; content: string } => ({ role, content: 'x'.repeat(n) })

  it('keeps the newest turns that fit, and always the question', () => {
    const history = [msg('user', 300), msg('assistant', 300), msg('user', 300), msg('assistant', 300), msg('user', 3000)]
    expect(fitHistory(history, 10)).toEqual([history[4]])
    expect(fitHistory(history, 1200)).toEqual(history.slice(2))
  })

  it('never starts with an answer', () => {
    const history = [msg('user', 30), msg('assistant', 30), msg('user', 30)]
    expect(fitHistory(history, 20)[0]!.role).toBe('user')
  })
})

describe('definitions', () => {
  const dirs: string[] = []
  const vault = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recto-bots-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('a vault without bots gets Recto, with its definition and SYSTEM.md', () => {
    const root = vault()
    const bots = listBots(root)
    expect(bots.map((b) => b.id)).toEqual(['recto'])
    expect(bots[0]!.look).toEqual(RECTO.look)
    expect(bots[0]!.system).toBe(RECTO_SYSTEM.trim())
    expect(fs.existsSync(path.join(root, '.recto/bots/recto/SYSTEM.md'))).toBe(true)
  })

  it('an unedited SYSTEM.md from an earlier version is brought up to date; an edited one is not', () => {
    const root = vault()
    listBots(root)
    const file = path.join(root, '.recto/bots/recto/SYSTEM.md')
    const shipped = execSync('git show 63445a2:src/main/bots/definitions.ts', { cwd: path.resolve(__dirname, '../../..') }).toString()
    const old = /export const RECTO_SYSTEM = `([\s\S]*?)`/.exec(shipped)![1]!
    fs.writeFileSync(file, old)
    expect(listBots(root)[0]!.system).toBe(RECTO_SYSTEM.trim())
    expect(RECTO_SYSTEM).toContain('Never mention the context')
    fs.writeFileSync(file, `${old}\n- My own rule.\n`)
    expect(listBots(root)[0]!.system).toContain('My own rule.')
  })

  it('a deleted Recto stays deleted', () => {
    const root = vault()
    listBots(root)
    fs.rmSync(path.join(root, '.recto/bots/recto'), { recursive: true })
    expect(listBots(root)).toEqual([])
  })

  it('a damaged definition falls back to the preset, a broken one is skipped', () => {
    const root = vault()
    const dir = path.join(root, '.recto/bots/calm')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'bot.json'),
      JSON.stringify({ name: 'Calm', look: 'nonsense', model: 'qwen3:14b', exclude: ['Journal', 3] }),
    )
    expect(readBot(dir)).toMatchObject({ id: 'calm', name: 'Calm', look: RECTO.look, model: 'qwen3:14b', exclude: ['Journal'], system: '' })
    const broken = path.join(root, '.recto/bots/broken')
    fs.mkdirSync(broken)
    fs.writeFileSync(path.join(broken, 'bot.json'), '{ not json')
    expect(readBot(broken)).toBeNull()
    expect(readBot(path.join(root, '.recto/bots/Bad Name'))).toBeNull()
  })
})

describe('ollama', () => {
  it('matches a model with or without its tag', () => {
    expect(hasModel(['qwen3.5:9b', 'llama3:latest'], 'qwen3.5:9b')).toBe(true)
    expect(hasModel(['qwen3.5:9b', 'llama3:latest'], 'llama3')).toBe(true)
    expect(hasModel(['qwen3.5:9b'], 'qwen3.5:4b')).toBe(false)
  })

  const stream = (...parts: string[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part))
        controller.close()
      },
    })

  it('reads the streamed lines into tokens, across chunk boundaries', async () => {
    const tokens: string[] = []
    const body = stream(
      '{"message":{"content":"Hel"},"done":false}\n{"message":{"con',
      'tent":"lo"},"done":false}\n',
      '{"message":{"content":""},"done":true}\n',
    )
    for await (const t of readLines(body)) tokens.push(t)
    expect(tokens).toEqual(['Hel', 'lo'])
  })

  it('turns an error line into a thrown error', async () => {
    const run = async (): Promise<void> => {
      for await (const _ of readLines(stream('{"error":"model \\"x\\" not found"}\n'))) void _
    }
    await expect(run()).rejects.toThrow('model "x" not found')
  })
})
