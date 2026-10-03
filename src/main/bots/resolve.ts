/**
 * Named notes and named scopes, resolved in code - the router never has to.
 *
 * Notes: "Tutta", «Transcript pipeline», [[links]] are looked up by title and
 * alias, case-insensitively, in any folder, and a misspelling is forgiven
 * ("Transcript pipeline" finds "Trasncript pipeline"). A title the question
 * spells out without quotes ("my trip to Japan" → "Japan trip") counts too.
 * A name that matches nothing is reported with the three closest titles, so
 * the answer can say so instead of answering from another note.
 *
 * Scopes: a folder ("my math notes" → Learning/Math Khan Academy), a project
 * folder ("Recto app"), a topic (the topics property), or the whole vault
 * ("my vault", «всё хранилище»).
 *
 * Pure: the vault's titles, folders and topics are passed in.
 */

export type VaultNote = { path: string; title: string; aliases: string[] }

export type Named = { path: string; title: string; by: 'quoted' | 'link' | 'title' }
export type NotFound = { asked: string; closest: string[] }

export type Scope =
  { kind: 'vault'; words: string } | { kind: 'folder'; folder: string; words: string } | { kind: 'topic'; topic: string; words: string }

const fold = (s: string): string => s.normalize('NFC').toLowerCase().replace(/ё/g, 'е').trim()
const WORD = /[\p{L}\p{N}]+/gu
const words = (s: string): string[] => fold(s).match(WORD) ?? []

/** Words that name nothing: a title made only of these is never spotted in a sentence. */
const COMMON = new Set(
  `a an and the of in on to for with about my your our notes note new old all list plan log daily task tasks
  what how why when where is are i me it this that from by at or be
  write wrote written read make made use used do did done look check find get set go see keep
  и в во на с со о об про для по к у из мои мой моя моё мне заметка заметки заметок задачи задача`.split(/\s+/),
)

/** Edit distance with transpositions (Damerau, optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  return d[a.length]![b.length]!
}

/** How alike two names are, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = fold(a)
  const y = fold(b)
  if (x === y) return 1
  const longest = Math.max(x.length, y.length)
  return longest === 0 ? 0 : 1 - editDistance(x, y) / longest
}

/**
 * Two words are the same word: equal, or one is the other with a short
 * ending ("manager" / "managers", «заметки» / «заметках»). "check" is not
 * "checklist".
 */
const sameWord = (a: string, b: string): boolean => {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 4 || long.length - short.length > 3) return false
  const stem = short.length >= 6 ? short.length - 2 : short.length - 1
  return long.startsWith(short.slice(0, Math.max(4, stem)))
}

/** What the question puts in quotes or links: "…", «…», “…”, [[…]]. */
export function quotedNames(question: string): { text: string; by: 'quoted' | 'link' }[] {
  const out: { text: string; by: 'quoted' | 'link' }[] = []
  for (const m of question.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.push({ text: m[1]!.trim(), by: 'link' })
  for (const m of question.matchAll(/"([^"\n]{2,80})"|«([^»\n]{2,80})»|“([^”\n]{2,80})”|„([^“”\n]{2,80})[“”]/g))
    out.push({ text: (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim(), by: 'quoted' })
  return out.filter((n) => n.text !== '')
}

/** The note a name means, by title or alias, exactly or nearly; null when nothing is close enough. */
export function findNote(name: string, notes: readonly VaultNote[]): VaultNote | null {
  let best: { note: VaultNote; score: number } | null = null
  for (const note of notes) {
    for (const candidate of [note.title, ...note.aliases]) {
      const score = nameSimilarity(name, candidate)
      if (best === null || score > best.score) best = { note, score }
    }
  }
  return best !== null && best.score >= 0.8 ? best.note : null
}

/** The three titles closest to a name that matched nothing. */
export function closestTitles(name: string, notes: readonly VaultNote[], n = 3): string[] {
  const asked = words(name)
  return [...notes]
    .map((note) => {
      const shared = words(note.title).filter((w) => asked.some((a) => sameWord(a, w))).length
      return { title: note.title, score: nameSimilarity(name, note.title) + shared * 0.3 }
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, n)
    .map((x) => x.title)
}

/**
 * Titles the question spells out without quotes: every word of the title
 * that names something is in the question ("trip to Japan" → "Japan trip",
 * "Kepano" → "Kepano about notes"). Dates, common words ("write" is not
 * "Write privacy policy") and one-word titles other titles share never count.
 */
export function spelledTitles(question: string, notes: readonly VaultNote[]): VaultNote[] {
  const q = words(question)
  const counts = new Map<string, number>()
  for (const note of notes) for (const w of new Set(words(note.title))) counts.set(w, (counts.get(w) ?? 0) + 1)
  const out: VaultNote[] = []
  for (const note of notes) {
    if (/^\d{4}-\d{2}-\d{2}/.test(note.title)) continue
    const meaningful = words(note.title).filter((w) => !COMMON.has(w) && w.length >= 3 && !/^\d+$/.test(w))
    if (meaningful.length === 0) continue
    const found = meaningful.filter((w) => q.some((x) => sameWord(x, w)))
    // A one-word title ("Tutta") must also be the only title with that word: "Recto" alone names no note.
    const all =
      found.length === meaningful.length && (meaningful.length >= 2 || (meaningful[0]!.length >= 5 && counts.get(meaningful[0]!) === 1))
    if (all) out.push(note)
  }
  return out
}

export function resolveNames(question: string, notes: readonly VaultNote[]): { named: Named[]; notFound: NotFound[] } {
  const named: Named[] = []
  const notFound: NotFound[] = []
  const add = (note: VaultNote, by: Named['by']): void => {
    if (!named.some((n) => n.path === note.path)) named.push({ path: note.path, title: note.title, by })
  }
  for (const q of quotedNames(question)) {
    const note = findNote(q.text, notes)
    if (note !== null) add(note, q.by)
    // A quoted phrase that is not a title may be just a quote; only a link or a title-like phrase is reported missing.
    else if (q.by === 'link' || q.text.split(/\s+/).length <= 4) notFound.push({ asked: q.text, closest: closestTitles(q.text, notes) })
  }
  // What was quoted is settled above: a quoted name that matched nothing is not looked for again word by word.
  const unquoted = question.replace(/\[\[[^\]]*\]\]|"[^"\n]*"|«[^»\n]*»|“[^”\n]*”|„[^“”\n]*[“”]/g, ' ')
  for (const note of spelledTitles(unquoted, notes)) add(note, 'title')
  return { named, notFound }
}

const VAULT_WIDE =
  /\b(my|the|whole|entire) vault\b|\ball (of )?(my )?notes\b|\bnotes (currently )?in my vault\b|\bmy notes\b(?! (on|about))|хранилищ|все(х|м)? (мои(х|м)? )?заметк|по всем заметкам|hele hvelvet|alle notatene/i

/** Folders that hold everything of one kind, never a subject: not a scope by name. */
const GENERIC_FOLDERS = /^(daily|tasks|templates?|attachments|chats|other|weblinks|projects?|notes|inbox)$/i

/**
 * The scope the question names, if any: the whole vault, a folder (by the
 * words of its name; the deepest best match), or a topic. A folder needs one
 * of its name's words that names something ("math", "recto") in the question.
 */
export function resolveScope(question: string, folders: readonly string[], topics: readonly string[]): Scope | null {
  const q = words(question)
  const matched: { folder: string; found: number; score: number }[] = []
  for (const folder of folders) {
    const leaf = folder.slice(folder.lastIndexOf('/') + 1)
    if (GENERIC_FOLDERS.test(leaf)) continue
    const meaningful = words(leaf).filter((w) => !COMMON.has(w) && w.length >= 3)
    if (meaningful.length === 0) continue
    const found = meaningful.filter((w) => q.some((x) => sameWord(x, w)))
    if (found.length === 0 || !found.some((w) => w.length >= 4)) continue
    matched.push({ folder, found: found.length, score: found.length / meaningful.length + found.length })
  }
  // A subfolder matched by no more words than its parent ("Recto app/Recto log" for "Recto") is the parent's.
  const kept = matched.filter((m) => !matched.some((p) => p !== m && m.folder.startsWith(`${p.folder}/`) && p.found >= m.found))
  const best = kept.sort((a, b) => b.score - a.score || b.folder.split('/').length - a.folder.split('/').length)[0]
  if (best !== undefined) return { kind: 'folder', folder: best.folder, words: best.folder.slice(best.folder.lastIndexOf('/') + 1) }
  for (const topic of topics) {
    const meaningful = words(topic).filter((w) => !COMMON.has(w) && w.length >= 4)
    if (meaningful.length > 0 && meaningful.every((w) => q.some((x) => sameWord(x, w)))) return { kind: 'topic', topic, words: topic }
  }
  if (VAULT_WIDE.test(question)) return { kind: 'vault', words: 'vault' }
  return null
}
