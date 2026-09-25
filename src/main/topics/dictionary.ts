import { readTable } from './lemma'
import type { Lang } from './naming'

/**
 * Nouns from one language to another, offline: Wiktionary's Russian and
 * Bokmål nouns with their English translations (resources/dictionaries, see
 * scripts/build-dictionaries.mjs). English to either is the same data turned
 * around; Russian <-> Bokmål goes through English. Every candidate it returns
 * is still checked against the topic by the embedding - a dictionary knows
 * what a word can mean, not what it means here.
 */

export type Dictionary = { translate: (word: string, from: Lang, to: Lang) => string[] }

const loaded = new Map<string, Dictionary>()

export function dictionary(dir: string): Dictionary {
  const hit = loaded.get(dir)
  if (hit !== undefined) return hit
  const toEnglish: Record<Exclude<Lang, 'en'>, Record<string, string[]>> = {
    ru: readTable(dir, 'ru-en.json.gz'),
    no: readTable(dir, 'nb-en.json.gz'),
  }
  const fromEnglish: Record<Exclude<Lang, 'en'>, Map<string, string[]>> = { ru: invert(toEnglish.ru), no: invert(toEnglish.no) }
  const translate = (word: string, from: Lang, to: Lang): string[] => {
    if (from === to) return [word]
    if (from === 'en') return fromEnglish[to as Exclude<Lang, 'en'>].get(word) ?? []
    const english = toEnglish[from][word] ?? []
    if (to === 'en') return english
    return [...new Set(english.flatMap((e) => fromEnglish[to].get(e) ?? []))]
  }
  const made = { translate }
  loaded.set(dir, made)
  return made
}

function invert(table: Record<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [word, english] of Object.entries(table)) for (const e of english) out.set(e, [...(out.get(e) ?? []), word])
  return out
}
