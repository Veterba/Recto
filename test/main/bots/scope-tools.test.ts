import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {}, powerMonitor: { isOnBatteryPower: () => false, getSystemIdleTime: () => 999 } }))
vi.mock('../../../src/main/index-client', () => ({ send: vi.fn() }))
vi.mock('../../../src/main/vault', () => ({ currentVault: () => null }))

import {
  noteOutline,
  notesInScope,
  projectNotes,
  structurePatterns,
  vaultMap,
  wholeNotes,
  type ScopeNote,
} from '../../../src/main/bots/scope-tools'
import { codeCard, languageOfText, mainHeadings } from '../../../src/main/bots/cards'
import { dailyThoughts, subjectFolder } from '../../../src/main/bots/tools'

const DAILY =
  '---\nLinks: "[[Daily]]"\n---\n\n## Tasks\n- [ ] Unit 6\n\n### Option tasks\n- [ ]\n\n## Notes / Thoughts\n- Empty\n\n## What I Learned (Option)\n- Empty\n'

const n = (path: string, content: string, extra: Partial<ScopeNote> = {}): ScopeNote => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  mtime: 0,
  size: content.length,
  noteDate: null,
  linksOut: 0,
  linksIn: 0,
  aliases: null,
  topics: null,
  tasks: 0,
  headings: [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ text: m[2]!, level: m[1]!.length })),
  content,
  ...extra,
})

const VAULT = [
  n('Daily/2026/09/W39/2026-09-21.md', DAILY),
  n('Daily/2026/09/W39/2026-09-22.md', DAILY),
  n('Template/Daily.md', DAILY),
  n('Learning/Math/Unit 4.md', '*Note about slope*\n\n**Slope**\nrise over run, many words here to count as a real note for sure ok'),
  n('Learning/Math/Unit 6.md', '*Note about systems*\n\nshort'),
  n('Other/Japan trip.md', '**Бюджет:**\n- 60k\n\n**Когда:**\n- март', { topics: '["[[topics/Travel · plan]]"]' }),
  n('Programming/Trasncript pipeline.md', 'about a pipeline', { linksOut: 1 }),
  n('Programming/Old/Transcript pipeline.md', 'x', { linksIn: 1 }),
  n('Просто заметка.md', '**a.** answer'),
]

describe('vault_map', () => {
  const map = vaultMap(VAULT, new Map([['Learning/Math/Unit 4.md', { summary: 's', language: 'ru', kind: 'learning', headings: [] }]]))

  it('lists folders with counts and kinds, date folders folded into their first level', () => {
    expect(map).toContain('- Daily/ — 2 notes (daily 2)')
    expect(map).toContain('  - Math/ — 2 notes (learning 1)')
    expect(map).not.toContain('W39/')
    expect(map).toContain('(vault root) — 1: Просто заметка')
  })

  it('finds stubs, empty dailies, orphans, look-alike titles, naming and templates', () => {
    expect(map).toMatch(/Empty or nearly empty notes \(\d+\)/)
    expect(map).toContain('Daily notes left as the empty template: 2 of 2')
    expect(map).toContain('"Trasncript pipeline" ~ "Transcript pipeline"')
    expect(map).toContain('notes opening with an italic "*Note about …*" line: 2')
    expect(map).toContain('- Daily: Tasks / Option tasks / Notes / Thoughts / What I Learned (Option)')
    expect(map).toContain('Travel · plan (1)')
  })
})

describe('structure_patterns', () => {
  it('groups notes by their heading skeleton and how they open', () => {
    const p = structurePatterns(VAULT)
    expect(p).toContain('- 3 notes: tasks / option tasks / notes / thoughts / what i learned (option)')
    expect(p).toContain('2 open with an italic "*Note about …*" line')
    expect(p).toContain('3 notes: Links — e.g. 2026-09-21')
  })
})

describe('note_outline', () => {
  it('shows sections with their size, the empty ones, bold lines as headings', () => {
    const o = noteOutline(n('a/Plan.md', '---\ntags: [x]\n---\nIntro line\n## Goal\n\n## Steps\none two three\n**Budget**\n60k'))
    expect(o).toContain('Properties: tags')
    expect(o).toContain('First line: Intro line')
    expect(o).toContain('- Goal — EMPTY')
    expect(o).toContain('- Steps — 3')
    expect(o).toContain('**Budget** (bold line) — 1')
  })
})

describe('scopes', () => {
  it('takes a folder, a topic or everything', () => {
    expect(notesInScope({ kind: 'folder', folder: 'Learning/Math', words: '' }, VAULT)).toHaveLength(2)
    expect(notesInScope({ kind: 'topic', topic: 'Travel · plan', words: '' }, VAULT).map((x) => x.title)).toEqual(['Japan trip'])
    expect(notesInScope({ kind: 'vault', words: '' }, VAULT)).toHaveLength(VAULT.length)
  })

  it('gives small scopes whole, big ones not', () => {
    expect(wholeNotes(VAULT.slice(3, 5), 10_000)).toContain('### Unit 4')
    expect(wholeNotes(VAULT, 100_000)).toBeNull()
    expect(wholeNotes(VAULT.slice(3, 5), 10)).toBeNull()
  })
})

describe('note cards without the model', () => {
  it('cards dailies and stubs in code, and leaves real notes to the model', () => {
    expect(codeCard('Daily/2026-09-21.md', '2026-09-21', DAILY)?.kind).toBe('daily')
    expect(codeCard('Programming/Yaml.md', 'Yaml', '*Note about Yaml*')?.kind).toBe('stub')
    expect(codeCard('Other/Long.md', 'Long', 'word '.repeat(40))).toBeNull()
  })

  it('knows the language and the main headings', () => {
    expect(languageOfText('Бюджет на поездку в Японию')).toBe('ru')
    expect(languageOfText('Hei, eg heiter Tutta. Kva er formålet med kampanjen og korleis')).toBe('no')
    expect(mainHeadings('Japan trip', '**Бюджет:**\n- 60k\n\n**Когда:**\n- март')).toEqual(['Бюджет', 'Когда'])
  })
})

describe('task grouping helpers', () => {
  it('reads a daily without its checklist', () => {
    expect(dailyThoughts(DAILY).trim()).toBe('')
    expect(dailyThoughts(DAILY.replace('- Empty', '- Fix the graph double text'))).toContain('Fix the graph double text')
  })

  it('finds the subject folder of a note', () => {
    expect(subjectFolder('Programming/Projects/Recto app/Recto plan.md')).toBe('Programming/Projects/Recto app')
    expect(subjectFolder('Programming/Projects/Recto app/Recto log/2026-09-12 — v0.1.md')).toBe('Programming/Projects/Recto app')
    expect(subjectFolder('Daily/2026/09/W39/2026-09-21.md')).toBeNull()
    expect(subjectFolder('tasks/0 Commit topics.md')).toBeNull()
    expect(subjectFolder('Просто заметка.md')).toBeNull()
  })
})

describe('projectNotes', () => {
  const notes = [
    n('Programming/Projects/Recto app/Recto plan.md', 'plan'),
    n('Programming/Projects/Recto app/Recto log/2026-10-03 — v0.43.0.md', 'log'),
    n('Other/Electron notes.md', 'x', { topics: '["[[topics/Recto]]"]' }),
    n('tasks/0 Commit topics.md', 'x', { project: '"[[Recto]]"' }),
    n('tasks/1 Architecture map.md', 'x', { linksTo: ['Programming/Projects/Recto app/Recto plan.md'] }),
    n('Daily/2026/09/W39/2026-09-21.md', DAILY, { linksTo: ['Programming/Projects/Recto app/Recto plan.md'] }),
    n('Other/Japan trip.md', 'x', { topics: '["[[topics/Travel · plan]]"]' }),
  ]

  it('topics first, then the project property, the folder, and notes linking in - never a daily by a link', () => {
    const found = projectNotes({ kind: 'folder', folder: 'Programming/Projects/Recto app', words: 'recto app' }, notes, [
      'Recto',
      'Travel · plan',
    ])
    expect(Object.fromEntries(found)).toEqual({
      'Other/Electron notes.md': 'topic',
      'tasks/0 Commit topics.md': 'project',
      'Programming/Projects/Recto app/Recto plan.md': 'folder',
      'Programming/Projects/Recto app/Recto log/2026-10-03 — v0.43.0.md': 'folder',
      'tasks/1 Architecture map.md': 'linking',
    })
  })
})
