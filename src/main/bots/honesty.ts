/**
 * Recto cannot change notes: no tool of its writes to the vault. A small model
 * asked to edit one still says "Я обновил заметку" and shows a changed table,
 * which is a lie about an action. Before an answer is shown, a sentence that
 * claims such an action is replaced with the honest one - once - and any
 * further claims are dropped. Run on the text so far while it streams, so a
 * half-written claim is never on screen either.
 *
 * Russian, English and Norwegian: first-person past tense of the editing
 * verbs ("я обновил", "I've updated", "jeg har endret"), and the passive
 * about a note or a table ("заметка обновлена", "the note has been updated").
 */

export type AnswerLang = 'ru' | 'en' | 'no'

// Letters on either side mean "inside a word": JavaScript's \b is ASCII-only.
const START = '(?<!\\p{L})'
const END = '(?!\\p{L})'

const RU_VERBS =
  '(?:обновил|изменил|удалил|создал|переименовал|отредактировал|исправил|внёс|внес|сохранил|заменил|добавил|переписал|дополнил|перенёс|перенес)а?'
const RU_PASSIVE =
  '(?:обновлен|изменен|изменён|удален|удалён|создан|переименован|отредактирован|исправлен|сохранен|сохранён|дополнен)[аоы]?'
const EN_VERBS = '(?:updated|changed|edited|modified|removed|deleted|created|renamed|added|saved|replaced|rewrote|rewritten|fixed|applied)'
const NO_VERBS = '(?:oppdatert|endret|endra|slettet|sletta|opprettet|oppretta|lagt til|lagret|lagra|redigert|rettet|retta|gitt nytt navn)'

const CLAIMS: readonly RegExp[] = [
  // "Я обновил…", "Готово, обновил заметку", "Обновила таблицу" at the start of a sentence.
  new RegExp(
    `^(?:[-*•]\\s*)?(?:(?:готово|хорошо|ок|отлично)[,!.:—-]?\\s*)?(?:я\\s+)?(?:уже\\s+|только что\\s+|сейчас\\s+)?${RU_VERBS}${END}(?!\\s+бы)`,
    'iu',
  ),
  new RegExp(`${START}я\\s+(?:уже\\s+|только что\\s+|сейчас\\s+)?${RU_VERBS}${END}(?!\\s+бы)`, 'iu'),
  new RegExp(`${START}(?:заметк[аеуи]|таблиц[аеуы]|файл|запис[ьи])\\s+(?:была\\s+|был\\s+|уже\\s+|теперь\\s+)?${RU_PASSIVE}${END}`, 'iu'),
  new RegExp(`${START}I(?:'ve|’ve| have)?\\s+(?:just\\s+|now\\s+|already\\s+)?${EN_VERBS}${END}`, 'u'),
  new RegExp(`${START}I(?:'ve|’ve| have)?\\s+(?:just\\s+|now\\s+)?made (?:the |those |these )?(?:changes|edits)${END}`, 'iu'),
  new RegExp(`${START}(?:the |your |this )?(?:note|table|file)\\s+(?:has been|was|is now)\\s+${EN_VERBS}${END}`, 'iu'),
  new RegExp(`${START}(?:jeg|eg)\\s+(?:har\\s+)?(?:nå\\s+|allerede\\s+)?${NO_VERBS}${END}`, 'iu'),
  new RegExp(`${START}(?:notatet|tabellen|fila|filen)\\s+(?:er|ble)\\s+(?:nå\\s+)?${NO_VERBS}${END}`, 'iu'),
]

export const HONEST: Record<AnswerLang, string> = {
  ru: 'Я не могу менять заметки — это предложение, внеси его сам.',
  en: "I can't change notes - this is a suggestion; apply it yourself.",
  no: 'Jeg kan ikke endre notater – dette er et forslag, og du må gjøre endringen selv.',
}

/** Does this sentence claim that Recto changed a note? */
export const claimsAction = (sentence: string): boolean => CLAIMS.some((re) => re.test(sentence.trim()))

/** The language to say it in: the question's. */
export function answerLang(question: string): AnswerLang {
  const letters = question.match(/\p{L}/gu) ?? []
  const cyrillic = letters.filter((l) => /\p{Script=Cyrillic}/u.test(l)).length
  if (letters.length > 0 && cyrillic / letters.length > 0.3) return 'ru'
  if (/[æøå]/i.test(question) || /\b(jeg|ikke|hva|hvilke|hvor|når|meg|mine?|kan du|skal|vil)\b/i.test(question)) return 'no'
  return 'en'
}

/**
 * The answer with every claim of an action replaced: the first by the honest
 * sentence, the rest removed. `wrote` is for a future tool that does write:
 * then a claim may be true and is left alone.
 */
export function honestAnswer(text: string, lang: AnswerLang, wrote = false): string {
  if (wrote) return text
  let said = false
  let changed = false
  // Sentences and line breaks, separators kept, so the answer is rebuilt exactly.
  const out = text.replace(/[^.!?…\n]+(?:[.!?…]+|$)[ \t]*/g, (sentence) => {
    if (!claimsAction(sentence)) return sentence
    changed = true
    const lead = /^\s*/.exec(sentence)?.[0] ?? ''
    const trail = /\s*$/.exec(sentence)?.[0] ?? ''
    if (said) return ''
    said = true
    return `${lead}${HONEST[lang]}${trail === '' ? '' : trail}`
  })
  return changed ? out : text
}
