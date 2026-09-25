import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import zlib from 'node:zlib'
import nlp from 'compromise'
import type { Lang } from './naming'

/**
 * Nouns in their base form, the only words a topic is named with: "памяти"
 * becomes "память", "registers" becomes "register", and verbs ("изучить",
 * "returns") never get a say.
 *
 * Offline and in-process. Russian goes through Az.js (OpenCorpora's
 * dictionary, 11 MB, MIT); English through compromise, which the editor's
 * syntax colouring already ships; Norwegian (Bokmål) through a form -> lemma
 * table of nouns built from Wiktionary (scripts/build-dictionaries.mjs). A
 * word the table does not know is not a candidate: no guessing at a lemma.
 */

type AzParse = { tag: { POST?: string }; normalize: () => { toString: () => string } }
type AzModule = { Morph: ((word: string) => AzParse[]) & { init: (dir: string, done: (err: unknown) => void) => void } }

let az: Promise<AzModule> | null = null

function loadAz(): Promise<AzModule> {
  az ??= new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url)
    const Az = require('az') as AzModule
    const dicts = path.join(path.dirname(require.resolve('az/package.json')), 'dicts')
    Az.Morph.init(dicts, (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(Az)))
  })
  return az
}

export type Lemmatizer = (text: string, lang: Lang) => string[]

const CYRILLIC_WORD = /\p{Script=Cyrillic}[\p{Script=Cyrillic}-]*\p{Script=Cyrillic}|\p{Script=Cyrillic}/gu

/** Parts of speech compromise tags on words that are not things. */
const NOT_A_THING = ['Pronoun', 'Value', 'Gerund', 'Verb', 'Adverb', 'Adjective', 'Determiner', 'Preposition', 'Conjunction']

function english(text: string): string[] {
  if (!/[A-Za-z]/.test(text)) return []
  const doc = nlp(text)
  doc.compute('root')
  const out: string[] = []
  for (const sentence of doc.json() as { terms: { normal?: string; root?: string; tags: string[] }[] }[]) {
    for (const term of sentence.terms) {
      if (!term.tags.includes('Noun') || NOT_A_THING.some((t) => term.tags.includes(t))) continue
      const word = (term.root ?? term.normal ?? '').toLowerCase()
      if (/^[a-z][a-z'-]*[a-z]$/.test(word)) out.push(word)
    }
  }
  return out
}

/** A single English word compromise reads as a noun, for translations into English. */
export function isEnglishNoun(word: string): boolean {
  const term = (nlp(word).json() as { terms: { tags: string[] }[] }[])[0]?.terms[0]
  return term !== undefined && term.tags.includes('Noun') && !NOT_A_THING.some((t) => term.tags.includes(t))
}

const NORWEGIAN_WORD = /\p{Script=Latin}[\p{Script=Latin}-]*\p{Script=Latin}|\p{Script=Latin}/gu

function norwegian(lemmas: Record<string, string>, text: string): string[] {
  const out: string[] = []
  for (const surface of text.toLowerCase().match(NORWEGIAN_WORD) ?? []) {
    const lemma = lemmas[surface]
    if (lemma !== undefined) out.push(lemma)
  }
  return out
}

/** A gzipped JSON table from the dictionaries folder. */
export function readTable<T>(dir: string, name: string): T {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString('utf8')) as T
}

function russian(Az: AzModule, text: string): string[] {
  const out: string[] = []
  for (const surface of text.toLowerCase().match(CYRILLIC_WORD) ?? []) {
    const best = Az.Morph(surface)[0]
    // toString, not .word: a hyphenated compound ("статус-код") has no .word.
    if (best?.tag.POST === 'NOUN') out.push(best.normalize().toString().replace(/ё/g, 'е'))
  }
  return out
}

const nbLemmas = new Map<string, Record<string, string>>()

/** Ready once the dictionaries are read (a few tenths of a second). `dictionaries` is resources/dictionaries. */
export async function lemmatizer(dictionaries: string): Promise<Lemmatizer> {
  const Az = await loadAz()
  if (!nbLemmas.has(dictionaries)) nbLemmas.set(dictionaries, readTable(dictionaries, 'nb-lemma.json.gz'))
  const nb = nbLemmas.get(dictionaries)!
  return (text, lang) => (lang === 'ru' ? russian(Az, text) : lang === 'en' ? english(text) : norwegian(nb, text))
}
