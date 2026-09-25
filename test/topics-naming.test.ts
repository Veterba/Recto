import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { dictionary } from '../src/main/topics/dictionary'
import { isEnglishNoun, lemmatizer, type Lemmatizer } from '../src/main/topics/lemma'
import {
  candidates,
  nameCluster,
  language,
  LANGUAGE_MARGIN,
  isProperName,
  nameable,
  nameText,
  pickKeywords,
  topicName,
  vaultLanguage,
  type Lang,
} from '../src/main/topics/naming'
import { switchLanguage, undoLast } from '../src/main/topics/runs'
import {
  allowed,
  coerceState,
  dissolve,
  dissolving,
  emptyState,
  isDeletedAgain,
  reject,
  topicLink,
  type TopicsState,
} from '../src/main/topics/state'
import { linksIn, writeLinks } from '../src/renderer/core/link-property'

/**
 * Topic names: prose only, nouns only, base forms, one language per vault -
 * and a vault that changes language renames its topics in one undoable run.
 */

const DICTIONARIES = path.join(__dirname, '../resources/dictionaries')

let lem: Lemmatizer
beforeAll(async () => {
  lem = await lemmatizer(DICTIONARIES)
})

/** A note as naming sees it: its nameable nouns. */
const terms = (text: string): string[] => {
  const prose = nameText(text)
  const lang = language(prose)
  return lem(prose, lang).filter((w) => nameable(w, lang))
}

/** Candidates for a cluster of `members` inside a vault of `members` plus `others`. */
const cands = (members: string[], others: string[]): string[] => {
  const docs = members.map(terms)
  return candidates(docs, members.length, [...docs, ...others.map(terms)])
}

const OTHERS = [
  'Sourdough bread needs flour, water and a starter.',
  'Guitar chords and strumming practice every evening.',
  'Marathon training plan with easy runs and long runs.',
  'Monstera care: light, watering and a chunky potting mix.',
]

describe('what a name is made from', () => {
  it('strips frontmatter, code, inline code, URLs, paths and link targets', () => {
    const text = [
      '---',
      'tags: [secretword]',
      '---',
      'The processor reads [[memory-target|memory]] and [[hiddenpage]].',
      '```ts',
      'const directory = loadCodeword()',
      '```',
      'See `inlinecode` at https://example.com/pathword and src/main/folderword.ts or ~/notes/homeword.',
      'A [link text](https://example.com/urlword) and file.json.',
    ].join('\n')
    const prose = nameText(text)
    for (const gone of ['secretword', 'memory-target', 'hiddenpage', 'directory', 'loadCodeword', 'inlinecode', 'pathword', 'folderword', 'homeword', 'urlword', 'file.json']) {
      expect(prose).not.toContain(gone)
    }
    for (const kept of ['processor', 'memory', 'link text']) expect(prose).toContain(kept)
  })

  it('never names a topic after code, paths or URLs', () => {
    const members = [
      'The cache keeps memory close. ```\ndir dir dir config config\n``` Run `dir` in src/dir/config.ts, see https://dir.example.com/config.',
      'Memory and the cache: `config` lives in ~/dir/config and https://example.org/dir.',
      'A cache miss goes to memory. The settings live in app/dir/config.json.',
    ]
    const names = cands(members, OTHERS)
    expect(names).not.toContain('dir')
    expect(names).not.toContain('config')
    expect(names.slice(0, 2).sort()).toEqual(['cache', 'memory'])
  })

  it('never names a topic after a verb or a filler word', () => {
    const ru = [
      'Изучить регистры процессора, попробовать написать. Возвращает значение.',
      'Нужно изучить регистры, попробовать ещё раз. Функция возвращает регистр процессора.',
      'Попробовать понять регистры и процессор. Изучить потом.',
    ]
    const ruNames = cands(ru, ['Хлеб на закваске и мука.', 'Гитара и аккорды каждый вечер.', 'План тренировок и бег.'])
    for (const verb of ['изучить', 'попробовать', 'возвращать', 'возвращает']) expect(ruNames).not.toContain(verb)
    expect(ruNames.slice(0, 2).sort()).toEqual(['процессор', 'регистр'])

    const en = [
      'Try to use the compiler. It returns tokens; try the parser next.',
      'Use the parser, then try the compiler again. Returns an error.',
      'The compiler returns a tree. Try, use, learn the parser.',
    ]
    const enNames = cands(en, OTHERS)
    for (const verb of ['try', 'use', 'return', 'returns', 'learn']) expect(enNames).not.toContain(verb)
    expect(enNames.slice(0, 2).sort()).toEqual(['compiler', 'parser'])
  })

  it('uses base forms', () => {
    expect(terms('Регистры процессора хранят данные в памяти.')).toEqual(expect.arrayContaining(['регистр', 'процессор', 'память']))
    expect(terms('Регистры процессора хранят данные в памяти.')).not.toContain('памяти')
    expect(terms('The registers of the processors hold addresses.')).toEqual(expect.arrayContaining(['register', 'processor', 'address']))
  })

  it('keeps only words in the vault language', () => {
    expect(nameable('память', 'ru')).toBe(true)
    expect(nameable('memory', 'ru')).toBe(false)
    expect(nameable('память', 'en')).toBe(false)
    expect(nameable('memory', 'en')).toBe(true)
  })

  it('makes no topic from a cluster with fewer than two shared candidates', () => {
    // Three notes about different things that merely look alike (plans): nothing most of them say.
    const plans = [
      'Plan: finish the kitchen shelves, buy a drill.',
      'Plan: read the Rust book, fix the bicycle.',
      'Plan: renew the passport, call the dentist.',
    ]
    const names = cands(plans, OTHERS)
    expect(names.length).toBeLessThan(2)
    expect(pickKeywords(names.map((term) => ({ term, sim: 0 })))).toBeNull()
  })

  it('drops a word most of the vault uses', () => {
    const vault = Array.from({ length: 6 }, (_, i) => `Programming note ${i}: programming with ${['rust', 'go', 'java', 'lisp', 'perl', 'ruby'][i]}.`)
    const members = ['Programming memory: the cache and memory.', 'Programming: memory and the cache.', 'Cache, memory, programming.']
    const docs = members.map(terms)
    expect(candidates(docs, 3, [...docs, ...vault.map(terms)])).not.toContain('programming')
  })

  it('names by the candidates closest to the centroid, first capitalised', () => {
    const keys = pickKeywords([
      { term: 'cache', sim: 0.1 },
      { term: 'processor', sim: 0.3 },
      { term: 'memory', sim: 0.2 },
    ])
    expect(keys).toEqual(['processor', 'memory', 'cache'])
    expect(topicName(keys!, new Set())).toBe('Processor · memory')
    expect(topicName(keys!, new Set(['processor · memory']))).toBe('Processor · memory · cache')
  })
})

describe('the vault language', () => {
  const counts = (ru: number, en: number): Partial<Record<Lang, number>> => ({ ru, en })

  it('is the language most notes are in', () => {
    expect(vaultLanguage(counts(10, 0), null)).toBe('ru')
    expect(vaultLanguage(counts(0, 10), null)).toBe('en')
    expect(vaultLanguage(counts(6, 4), null)).toBe('ru')
    expect(vaultLanguage(counts(4, 6), null)).toBe('en')
  })

  it('does not flip inside the margin', () => {
    expect(vaultLanguage(counts(5, 5), 'en')).toBe('en')
    expect(vaultLanguage(counts(5, 5), 'ru')).toBe('ru')
    expect(vaultLanguage(counts(5 + LANGUAGE_MARGIN - 1, 5), 'en')).toBe('en')
  })

  it('switches once another language leads by the margin - unless that switch was undone', () => {
    expect(vaultLanguage(counts(5 + LANGUAGE_MARGIN, 5), 'en')).toBe('ru')
    expect(vaultLanguage(counts(5 + LANGUAGE_MARGIN, 5), 'en', 'ru')).toBe('en')
  })

  it('tells a note’s language by its script and stopwords', () => {
    expect(language('Процессор и память компьютера работают вместе')).toBe('ru')
    expect(language('Jeg skal lære norsk og det er ikke lett for meg')).toBe('no')
    expect(language('The processor reads memory through the cache')).toBe('en')
  })
})

describe('a language switch', () => {
  // Written the way the app writes them.
  const note = (topics: string[], body: string): string =>
    writeLinks(['---', 'tags: [cs]', '---', body, ''].join('\n'), 'topics', topics.map(topicLink))

  const files: Record<string, string> = {
    'a.md': note(['Processor · memory'], 'Registers. See [[Processor · memory]] and [[Processor]] - ordinary notes.'),
    'b.md': note(['Processor · memory', 'Chords · strumming'], 'Stack and heap.'),
    'c.md': note(['Chords · strumming'], 'Guitar.'),
    'd.md': note(['My own name'], 'Hand-named.'),
  }
  const state: TopicsState = {
    ...emptyState(),
    builtAt: 1,
    language: 'en',
    topics: [
      { id: 't1', name: 'Processor · memory', renamedByUser: false },
      { id: 't2', name: 'Chords · strumming', renamedByUser: false },
      { id: 't3', name: 'My own name', renamedByUser: true },
    ],
    assigned: { 'a.md': ['t1'], 'b.md': ['t1', 't2'], 'c.md': ['t2'], 'd.md': ['t3'] },
    owned: { 'a.md': ['t1'], 'b.md': ['t1', 't2'], 'c.md': ['t2'], 'd.md': ['t3'] },
  }
  const carriers = { t1: ['a.md', 'b.md'], t2: ['b.md', 'c.md'], t3: ['d.md'] }
  // t2's notes give no two Russian candidates: removed. t3 was renamed by hand: offered a name, still untouched.
  const names = { t1: 'Процессор · память', t2: null, t3: 'Не трогать' }
  const read = (over: Map<string, string>) => (p: string) => over.get(p) ?? files[p] ?? null
  const switched = switchLanguage(state, 'ru', names, carriers, read(new Map()), 42)
  const after = (p: string): string => switched.writes.get(p) ?? files[p]!

  it('renames every machine-named topic in the notes, in one run', () => {
    expect(linksIn(after('a.md'), 'topics')).toEqual(['topics/Процессор · память'])
    expect(linksIn(after('b.md'), 'topics')).toEqual(['topics/Процессор · память'])
    expect(switched.state.language).toBe('ru')
    expect(switched.state.runs).toHaveLength(1)
    expect(switched.run.changes.map((c) => `${c.op} ${c.path}`).sort()).toEqual(['remove b.md', 'remove c.md', 'rename a.md', 'rename b.md'])
  })

  it('leaves plain links to real notes alone', () => {
    expect(after('a.md')).toContain('See [[Processor · memory]] and [[Processor]] - ordinary notes.')
  })

  it('removes a topic with no name in the new language', () => {
    expect(switched.state.topics.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(linksIn(after('c.md'), 'topics')).toEqual([])
    expect(switched.state.assigned['c.md']).toBeUndefined()
  })

  it('never touches a topic the user renamed', () => {
    expect(switched.writes.has('d.md')).toBe(false)
    expect(switched.state.topics.find((t) => t.id === 't3')).toEqual({ id: 't3', name: 'My own name', renamedByUser: true })
  })

  it('is undone as a whole by one Undo, and not made again by itself', () => {
    const undone = undoLast(switched.state, read(switched.writes))
    for (const p of Object.keys(files)) expect(undone.writes.get(p) ?? after(p)).toBe(files[p])
    expect(undone.state).toEqual({ ...state, declinedLanguage: 'ru' })
    expect(vaultLanguage({ ru: 20, en: 5 }, undone.state.language, undone.state.declinedLanguage)).toBe('en')
  })

  it('survives being written to disk and read back', () => {
    expect(coerceState(JSON.parse(JSON.stringify(switched.state)))).toEqual(switched.state)
  })
})

describe('Norwegian (Bokmål) lemmas', () => {
  const nouns = (text: string): string[] => lem(text, 'no').filter((w) => nameable(w, 'no'))

  it('maps inflected nouns to their lemma', () => {
    expect(nouns('Boka ligger på bordet. Bøkene og husene ved skolene.')).toEqual(['bok', 'bord', 'bok', 'hus', 'skole'])
  })

  it('knows only nouns: a word that is only a verb gives nothing', () => {
    // (A form that is also a noun - "leser", reader - does count: the table cannot tell them apart.)
    expect(nouns('Jeg har vært der, det ligger fint')).toEqual([])
  })
})

describe('names across languages', () => {
  /**
   * A stand-in for the model: words are vectors of their concept, so a word
   * and its translation are close, with a small offset per language like the
   * real one.
   */
  const CONCEPTS: Record<string, number> = {
    память: 0, memory: 0, процессор: 1, processor: 1, регистр: 2, register: 2,
    хлеб: 3, bread: 3, тесто: 4, dough: 4, закваска: 5, starter: 5,
  }
  const embed = async (words: string[]): Promise<Float32Array[]> =>
    words.map((w) => {
      const v = new Float32Array(10)
      if (w in CONCEPTS) v[CONCEPTS[w]!] = 1
      else v[9] = 1
      v[8] = /\p{Script=Cyrillic}/u.test(w) ? 0.3 : -0.3
      const n = Math.hypot(...v)
      return v.map((x) => x / n)
    })
  const center = (axes: number[]): Float32Array => {
    const v = new Float32Array(10)
    for (const a of axes) v[a] = 1
    return v.map((x) => x / Math.sqrt(axes.length))
  }
  const base = {
    taken: new Set<string>(),
    embed,
    translate: dictionary(DICTIONARIES).translate,
    isNoun: (w: string, l: Lang) => l !== 'en' || isEnglishNoun(w),
  }
  const member = (text: string) => ({ lang: language(text), terms: terms(text), prose: text })
  const others = ['Хлеб на закваске и мука.', 'Гитара и аккорды каждый вечер.', 'План тренировок и бег.', 'Sourdough bread and flour.', 'Guitar chords.']

  it('names a Russian cluster in an English vault in English', async () => {
    const members = [
      'Процессор читает память, регистр хранит адрес.',
      'Регистр процессора и память компьютера.',
      'Память, процессор и регистр: как работает компьютер.',
    ].map(member)
    const named = await nameCluster({ ...base, members, vault: [...members.map((m) => m.terms), ...others.map(terms)], vaultLang: 'en', center: center([0, 1]) })
    expect(named.from).toBe('ru')
    expect(named.name).toMatch(/^(Memory · processor|Processor · memory)$/)
  })

  it('names an English cluster in a Russian vault in Russian', async () => {
    const members = ['Dough needs a starter; the bread rises.', 'Bread dough and a lively starter.', 'Starter, dough, and a good bread.'].map(member)
    const named = await nameCluster({ ...base, members, vault: [...members.map((m) => m.terms), ...others.map(terms)], vaultLang: 'ru', center: center([3, 4]) })
    expect(named.from).toBe('en')
    expect(named.name).toMatch(/^(Хлеб · тесто|Тесто · хлеб)$/)
  })

  it('makes no topic when no translation means the topic', async () => {
    // The centroid points elsewhere: every translation is far from it.
    const members = [
      'Процессор читает память, регистр хранит адрес.',
      'Регистр процессора и память компьютера.',
      'Память, процессор и регистр: как работает компьютер.',
    ].map(member)
    const named = await nameCluster({ ...base, members, vault: [...members.map((m) => m.terms), ...others.map(terms)], vaultLang: 'en', center: center([6, 7]) })
    expect(named).toMatchObject({ name: null, failed: 'translation' })
  })

  it('does not translate a name: Rust the language is not rust the corrosion', () => {
    expect(isProperName('rust', ['Rust has traits. In Rust, ownership...', 'Rust lifetimes'])).toBe(true)
    expect(isProperName('memory', ['Memory is slow. The memory holds data.'])).toBe(false)
  })
})

describe('what the user excluded stays excluded', () => {
  const on = (s: TopicsState, p: string, id: string): TopicsState => ({ ...s, owned: { ...s.owned, [p]: [...(s.owned[p] ?? []), id] }, assigned: { ...s.assigned, [p]: [...(s.assigned[p] ?? []), id] } })
  let state: TopicsState = { ...emptyState(), builtAt: 1, language: 'en', topics: [{ id: 't1', name: 'Processor · memory', renamedByUser: false }] }
  for (const p of ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']) state = on(state, p, 't1')

  it('removing a topic from a note (×) is permanent for that note', () => {
    const next = reject(state, 'a.md', 't1')
    expect(allowed(next, 'a.md', 't1')).toBe(false)
    expect(allowed(next, 'b.md', 't1')).toBe(true)
    expect(dissolving(next)).toEqual([])
  })

  it('removed from more than half its notes, a topic is dissolved - and not made again from the same notes', () => {
    let next = state
    for (const p of ['a.md', 'b.md']) next = reject(next, p, 't1')
    expect(dissolving(next)).toEqual([])
    next = reject(next, 'c.md', 't1')
    expect(dissolving(next)).toEqual(['t1'])
    const gone = dissolve(next, 't1')
    expect(gone.topics).toEqual([])
    expect(gone.deleted).toEqual(['t1'])
    expect(Object.keys(gone.owned)).toEqual([])
    expect(isDeletedAgain(gone, new Set(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']))).toBe(true)
    expect(isDeletedAgain(gone, new Set(['b.md', 'c.md', 'd.md', 'x.md']))).toBe(true)
    expect(isDeletedAgain(gone, new Set(['x.md', 'y.md', 'z.md']))).toBe(false)
  })

  it('survives a re-index: it lives in the vault, read back field by field', () => {
    const next = reject(reject(state, 'a.md', 't1'), 'b.md', 't1')
    const back = coerceState(JSON.parse(JSON.stringify(next)))
    expect(back.blocks).toEqual(next.blocks)
    expect(back.rejected).toEqual(next.rejected)
  })

  it('survives a language switch, and its Undo', () => {
    const excluded = reject(state, 'a.md', 't1')
    const texts: Record<string, string> = Object.fromEntries(
      ['b.md', 'c.md', 'd.md', 'e.md'].map((p) => [p, writeLinks('---\n---\nBody.\n', 'topics', [topicLink('Processor · memory')])]),
    )
    texts['a.md'] = '---\n---\nBody.\n'
    const switched = switchLanguage(excluded, 'ru', { t1: 'Процессор · память' }, { t1: ['b.md', 'c.md', 'd.md', 'e.md'] }, (p) => texts[p] ?? null, 2)
    expect(switched.writes.has('a.md')).toBe(false)
    expect(switched.state.blocks).toEqual(excluded.blocks)
    expect(switched.state.rejected).toEqual(excluded.rejected)
    // The user takes it out of three more notes after the switch: dissolved. Undoing the switch brings back neither.
    let after = switched.state
    for (const p of ['b.md', 'c.md']) after = reject(after, p, 't1')
    after = dissolve(after, 't1')
    const undone = undoLast(after, (p) => switched.writes.get(p) ?? texts[p] ?? null)
    expect(undone.state.topics).toEqual([])
    expect(undone.state.deleted).toEqual(['t1'])
    expect(undone.state.blocks).toEqual(after.blocks)
    expect(undone.state.rejected).toEqual(after.rejected)
    expect(Object.values(undone.state.owned).flat()).not.toContain('t1')
  })

  it('an Undo never puts back a topic the user took out of a note since', () => {
    const run = { at: 1, label: 'x', changes: [{ path: 'a.md', property: 'topics', link: topicLink('Processor · memory'), op: 'remove' as const, topic: 't1' }] }
    const excluded = { ...reject(state, 'a.md', 't1'), runs: [run] }
    const undone = undoLast(excluded, () => '---\n---\nBody.\n')
    expect(undone.writes.size).toBe(0)
  })
})
