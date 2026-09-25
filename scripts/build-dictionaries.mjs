// Builds the offline dictionaries topic naming ships with, from Wiktionary.
//
//   node scripts/build-dictionaries.mjs <kaikki-Russian.jsonl[.gz]> <kaikki-NorwegianBokmål.jsonl[.gz]>
//
// Input: kaikki.org's machine-readable extracts of the English Wiktionary
// (https://kaikki.org/dictionary/Russian/, .../Norwegian Bokmål/), which are
// CC BY-SA 4.0 and GFDL like Wiktionary itself. Output, into
// resources/dictionaries/:
//
//   ru-en.json.gz    Russian noun lemma -> English nouns it translates to
//   nb-en.json.gz    Bokmål noun lemma  -> English nouns
//   nb-lemma.json.gz Bokmål noun form   -> lemma ("boka" -> "bok")
//
// English -> Russian and English -> Bokmål are these, inverted at load time;
// Russian <-> Bokmål goes through English. Only nouns: topic names are nouns.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import zlib from 'node:zlib'

const [ruFile, nbFile] = process.argv.slice(2)
if (!ruFile || !nbFile) {
  console.error('usage: node scripts/build-dictionaries.mjs <Russian.jsonl[.gz]> <NorwegianBokmål.jsonl[.gz]>')
  process.exit(1)
}
const OUT = path.join(import.meta.dirname, '..', 'resources', 'dictionaries')
/** Translations kept per word: the first senses, which Wiktionary lists most common first. */
const MAX_TRANSLATIONS = 6
const SKIP_SENSE = ['obsolete', 'archaic', 'dated', 'rare', 'nonstandard', 'misspelling']
const ENGLISH_WORD = /^[a-z][a-z-]*[a-z]$/

async function* entries(file) {
  const input = fs.createReadStream(file)
  const lines = readline.createInterface({ input: file.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input, crlfDelay: Infinity })
  for await (const line of lines) if (line.trim() !== '') yield JSON.parse(line)
}

/** Lowercase, no stress marks; ё as е, as the lemmatizer writes it. */
const clean = (word) => word.normalize('NFD').replace(/́|̀/g, '').normalize('NFC').toLowerCase().replace(/ё/g, 'е')

/**
 * The one-word English nouns a sense translates to: its linked words, then its
 * gloss split at commas. Words only in parentheses are labels ("(mathematics)
 * fraction"), not translations.
 */
function englishOf(sense) {
  const out = []
  const outside = ` ${(sense.glosses ?? []).join(' ').replace(/\([^)]*\)/g, ' ').toLowerCase()} `
  for (const [, target] of sense.links ?? []) {
    const word = String(target).split('#')[0].trim().toLowerCase()
    if (ENGLISH_WORD.test(word) && new RegExp(`[^a-z]${word}[^a-z]`).test(outside)) out.push(word)
  }
  for (const gloss of sense.glosses ?? []) {
    for (const part of gloss.replace(/\([^)]*\)/g, '').split(/[,;]/)) {
      const word = part.trim().toLowerCase().replace(/^(a|an|the)\s+/, '')
      if (ENGLISH_WORD.test(word)) out.push(word)
    }
  }
  return out
}

const isFormOf = (entry) => (entry.senses ?? []).every((s) => (s.form_of ?? s.alt_of) !== undefined || (s.tags ?? []).includes('form-of'))

async function glossary(file, lang) {
  const table = {}
  const lemma = {}
  for await (const entry of entries(file)) {
    if (entry.lang_code !== lang || entry.pos !== 'noun' || typeof entry.word !== 'string') continue
    const word = clean(entry.word)
    if (word.includes(' ')) continue
    if (isFormOf(entry)) {
      // "boka": a form of "bok".
      for (const s of entry.senses ?? []) for (const of of s.form_of ?? []) if (typeof of.word === 'string') lemma[word] ??= clean(of.word)
      continue
    }
    lemma[word] = word
    for (const form of entry.forms ?? []) {
      const tags = form.tags ?? []
      if (typeof form.form !== 'string' || tags.some((t) => ['romanization', 'table-tags', 'inflection-template', 'class'].includes(t))) continue
      const f = clean(form.form)
      if (!f.includes(' ') && /^\p{L}[\p{L}-]*$/u.test(f)) lemma[f] ??= word
    }
    const english = []
    for (const sense of entry.senses ?? []) {
      if ((sense.tags ?? []).some((t) => SKIP_SENSE.includes(t))) continue
      for (const w of englishOf(sense)) if (!english.includes(w)) english.push(w)
    }
    if (english.length > 0) table[word] = [...new Set([...(table[word] ?? []), ...english])].slice(0, MAX_TRANSLATIONS)
  }
  return { table, lemma }
}

function write(name, data) {
  const gz = zlib.gzipSync(JSON.stringify(data), { level: 9 })
  fs.writeFileSync(path.join(OUT, name), gz)
  console.log(`${name}: ${Object.keys(data).length} entries, ${(gz.length / 1e6).toFixed(2)} MB`)
}

fs.mkdirSync(OUT, { recursive: true })
const ru = await glossary(ruFile, 'ru')
write('ru-en.json.gz', ru.table)
const nb = await glossary(nbFile, 'nb')
write('nb-en.json.gz', nb.table)
write('nb-lemma.json.gz', nb.lemma)
