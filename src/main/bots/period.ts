/**
 * Time words → a date range, in code: "last week", "в среду", "since Monday",
 * "på onsdag", "yesterday", "the last 3 days", "23 сентября", "2026-09-23".
 * The router only hands over the words; a small model's date arithmetic is
 * not to be trusted.
 *
 * Weeks run Monday to Sunday. A weekday means the most recent one before
 * today ("on Wednesday", said on a Wednesday, is a week ago); "from
 * Wednesday" is that day too (what came from it), while "since Wednesday" /
 * «со среды» runs from it to today.
 */

export type Period = { from: string; to: string }

const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** Monday of the week `d` is in. */
const monday = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7))

/** Weekday stems → 0 (Monday) … 6 (Sunday), in English, Russian and Norwegian. */
const WEEKDAYS: readonly [RegExp, number][] = [
  [/\b(monday|mon)\b|понедельн|\bmandag/i, 0],
  [/\b(tuesday|tue)\b|вторник|\btirsdag/i, 1],
  [/\b(wednesday|wed)\b|сред[ауые]|\bonsdag/i, 2],
  [/\b(thursday|thu)\b|четверг|\btorsdag/i, 3],
  [/\b(friday|fri)\b|пятниц|\bfredag/i, 4],
  [/\b(saturday|sat)\b|суббот|\blørdag/i, 5],
  [/\b(sunday|sun)\b|воскресен|\bsøndag/i, 6],
]

const MONTHS: readonly [RegExp, number][] = [
  [/\bjan(uary)?\b|январ|\bjanuar/i, 0],
  [/\bfeb(ruary)?\b|феврал|\bfebruar/i, 1],
  [/\bmar(ch)?\b|март|\bmars\b/i, 2],
  [/\bapr(il)?\b|апрел/i, 3],
  [/\bmay\b|(?<![а-яё])ма[йя](?![а-яё])|\bmai\b/i, 4],
  [/\bjun(e)?\b|июн|\bjuni\b/i, 5],
  [/\bjul(y)?\b|июл|\bjuli\b/i, 6],
  [/\baug(ust)?\b|август/i, 7],
  [/\bsep(t|tember)?\b|сентябр/i, 8],
  [/\boct(ober)?\b|октябр|\boktober/i, 9],
  [/\bnov(ember)?\b|ноябр/i, 10],
  [/\bdec(ember)?\b|декабр|\bdesember/i, 11],
]

export function periodFrom(text: string, today: Date): Period | null {
  const t = text.toLowerCase()
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // Explicit dates: 2026-09-23, or "23 сентября" / "September 23" / "23. september".
  const isoDates = [...t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`)
  if (isoDates.length > 0) return { from: isoDates[0]!, to: isoDates.at(-1)! }
  for (const [re, month] of MONTHS) {
    if (!re.test(t)) continue
    const m = new RegExp(`(\\d{1,2})\\.?\\s*(?:${re.source})|(?:${re.source})\\s*(\\d{1,2})\\b`, 'i').exec(t)
    const date = m?.slice(1).find((g) => g !== undefined && /^\d{1,2}$/.test(g))
    if (date !== undefined) {
      let d = new Date(day.getFullYear(), month, Number(date))
      if (d > day) d = new Date(day.getFullYear() - 1, month, Number(date))
      return { from: iso(d), to: iso(d) }
    }
  }

  // Relative spans.
  const lastN = /(?:last|past|последн\S*|за)\s+(\d{1,2})\s+(?:days?|дн\S*|dager|dagene)/i.exec(t)
  if (lastN !== null) return { from: iso(addDays(day, -(Number(lastN[1]) - 1))), to: iso(day) }
  // "This and last week" / «на этой и прошлой неделе»: from last week's Monday to today.
  if (
    /\bthis and (last|previous) week|\b(last|previous) and this week|эт\S* и прошл\S* недел|прошл\S* и эт\S* недел|\bdenne og forrige uke/i.test(
      t,
    )
  )
    return { from: iso(addDays(monday(day), -7)), to: iso(day) }
  if (/\b(last|previous) week\b|прошл\S* недел|предыдущ\S* недел|\bforrige uke/i.test(t)) {
    const start = addDays(monday(day), -7)
    // "Wednesday last week" / «в среду на прошлой неделе»: that day of last week.
    const weekday = WEEKDAYS.find(([re]) => re.test(t))
    if (weekday !== undefined) return { from: iso(addDays(start, weekday[1])), to: iso(addDays(start, weekday[1])) }
    return { from: iso(start), to: iso(addDays(start, 6)) }
  }
  if (/\bthis week\b|эт\S* недел|на неделе|\bdenne uk(a|en)/i.test(t)) return { from: iso(monday(day)), to: iso(day) }
  if (/\b(last|past) month\b|прошл\S* месяц|\bforrige måned/i.test(t)) {
    const start = new Date(day.getFullYear(), day.getMonth() - 1, 1)
    return { from: iso(start), to: iso(new Date(day.getFullYear(), day.getMonth(), 0)) }
  }
  if (/\bthis month\b|эт\S* месяц|\bdenne måneden/i.test(t))
    return { from: iso(new Date(day.getFullYear(), day.getMonth(), 1)), to: iso(day) }
  if (/\bday before yesterday\b|позавчера|\bi forgårs/i.test(t)) return { from: iso(addDays(day, -2)), to: iso(addDays(day, -2)) }
  if (/\byesterday\b|вчера|\bi går\b/i.test(t)) return { from: iso(addDays(day, -1)), to: iso(addDays(day, -1)) }
  if (/\btoday\b|сегодня|\bi dag\b/i.test(t)) return { from: iso(day), to: iso(day) }

  // A weekday: "since Monday" runs to today; otherwise that one day, the most recent before today.
  for (const [re, weekday] of WEEKDAYS) {
    if (!re.test(t)) continue
    const back = ((day.getDay() + 6) % 7) - weekday
    const since = /\bsince\b|(?:^|\s)(с|со)\s|\bsiden\b/i.test(t)
    const back1 = back > 0 ? -back : -(back + 7)
    if (since) return { from: iso(addDays(day, back1)), to: iso(day) }
    const d = addDays(day, back1)
    return { from: iso(d), to: iso(d) }
  }
  return null
}

/** "2026-09-30, Wednesday": today as the router and the prompt are told it. */
export const todayLine = (today: Date): string => `${iso(today)}, ${today.toLocaleDateString('en-GB', { weekday: 'long' })}`

export { iso as isoDate }
