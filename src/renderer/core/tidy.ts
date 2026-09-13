/**
 * Tidy: decide where loose notes belong.
 *
 * A loose note is one sitting at the vault root. Tidy reads the signals the
 * note already carries - its tags, the notes it links to, the words in its name
 * - and proposes a folder. It proposes; it never moves anything. The caller
 * shows the plan and the user agrees to it, because this rewrites `[[links]]`
 * across the vault and "it reorganised my notes and I am not sure what it did"
 * is the one outcome that would make the feature not worth having.
 *
 * There is no model here and no network call. Every rule is something the user
 * themselves put in the file, which is also why the plan can explain itself in
 * one line per note.
 *
 * The rules, strongest first. The bar for CREATING a folder rises as the signal
 * gets weaker, because a new folder is a bigger commitment than a move into one
 * that already exists:
 *
 *   1. a tag that matches an existing folder      → move there
 *   2. most of its links point into one folder    → move there
 *   3. a word in its name matches a folder        → move there
 *   4. ≥2 loose notes share a tag                 → new folder, named for the tag
 *   5. ≥3 loose notes share a word in their names → new folder, named for the word
 *   otherwise                                     → left alone, and said so
 */

export type TidyMove = {
  path: string
  /** Destination folder, vault-relative. */
  into: string
  /** True when the folder does not exist yet. */
  creates: boolean
  /** One line, shown in the preview. The user should never have to guess. */
  reason: string
}

export type TidyPlan = {
  moves: TidyMove[]
  /** Loose notes with no usable signal, with why. */
  skipped: { path: string; reason: string }[]
}

export type TidyInput = {
  /** Every note in the vault, vault-relative. */
  notes: readonly string[]
  /** Every folder, vault-relative. */
  folders: readonly string[]
  /** Tags and resolved outgoing links, by note path. */
  context: ReadonlyMap<string, { tags: readonly string[]; links: readonly string[] }>
  /** Folders Tidy must never touch or move into, e.g. the card folder. */
  reserved?: readonly string[]
}

/** Two notes sharing a tag is a group; two sharing a word might be a coincidence. */
const MIN_FOR_TAG_FOLDER = 2
const MIN_FOR_NAME_FOLDER = 3

/**
 * Words that carry no information about where a note belongs.
 *
 * Deliberately short: an over-eager stoplist silently refuses to group things,
 * and a wrong grouping is visible in the preview while a missing one is not.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'my', 'new',
  'untitled', 'note', 'notes', 'draft', 'copy', 'final', 'misc', 'temp',
])

const normalise = (value: string): string =>
  value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Significant words in a file name. */
export function nameTokens(path: string): string[] {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  return base
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\p{N}+$/u.test(word))
}

/** Title Case for a folder name we are inventing. */
const folderName = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

const folderOf = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

export function planTidy(input: TidyInput): TidyPlan {
  const reserved = new Set(input.reserved ?? [])
  const isReserved = (folder: string): boolean =>
    reserved.has(folder) || [...reserved].some((r) => folder === r || folder.startsWith(`${r}/`))

  const folders = input.folders.filter((folder) => folder !== '' && !isReserved(folder))
  const byNormalisedName = new Map<string, string>()
  for (const folder of folders) {
    // Last segment only: a note tagged #work should find `projects/work`.
    const leaf = folder.slice(folder.lastIndexOf('/') + 1)
    const key = normalise(leaf)
    // First wins, so a shallower folder beats a deeply nested one of the name.
    if (key !== '' && !byNormalisedName.has(key)) byNormalisedName.set(key, folder)
  }

  const loose = input.notes.filter((path) => folderOf(path) === '' && !isReserved(path))
  const moves: TidyMove[] = []
  const skipped: { path: string; reason: string }[] = []
  const undecided: string[] = []

  for (const path of loose) {
    const signals = input.context.get(path)
    const tags = signals?.tags ?? []
    const links = signals?.links ?? []

    // --- 1. a tag naming an existing folder ------------------------------
    const taggedFolder = tags
      .map((tag) => byNormalisedName.get(normalise(tag)))
      .find((folder): folder is string => folder !== undefined)
    if (taggedFolder !== undefined) {
      moves.push({
        path,
        into: taggedFolder,
        creates: false,
        reason: `tagged #${tags.find((tag) => byNormalisedName.get(normalise(tag)) === taggedFolder)?.replace(/^#/, '')}`,
      })
      continue
    }

    // --- 2. where its links live -----------------------------------------
    const counts = new Map<string, number>()
    for (const target of links) {
      const folder = folderOf(target)
      if (folder === '' || isReserved(folder)) continue
      counts.set(folder, (counts.get(folder) ?? 0) + 1)
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    if (best !== undefined) {
      const [folder, count] = best
      const tie = [...counts.values()].filter((n) => n === count).length > 1
      // A tie is not a signal - it is two equally good answers, and guessing
      // between them is how a tidy-up loses your trust.
      if (!tie) {
        moves.push({
          path,
          into: folder,
          creates: false,
          reason: `links to ${count} note${count === 1 ? '' : 's'} in ${folder}`,
        })
        continue
      }
    }

    // --- 3. a word in its name naming an existing folder -------------------
    const tokens = nameTokens(path)
    const namedFolder = tokens
      .map((token) => byNormalisedName.get(token))
      .find((folder): folder is string => folder !== undefined)
    if (namedFolder !== undefined) {
      moves.push({ path, into: namedFolder, creates: false, reason: `name matches ${namedFolder}` })
      continue
    }

    undecided.push(path)
  }

  // --- 4 & 5. group what is left into new folders -------------------------
  const group = (
    keyOf: (path: string) => string[],
    minimum: number,
    label: (key: string) => string,
  ): void => {
    const buckets = new Map<string, string[]>()
    for (const path of undecided) {
      for (const key of new Set(keyOf(path))) {
        const list = buckets.get(key)
        if (list) list.push(path)
        else buckets.set(key, [path])
      }
    }

    // Biggest group first, so a note that fits two groups lands in the stronger
    // one instead of whichever happened to be iterated first.
    const ordered = [...buckets.entries()]
      .filter(([key, paths]) => key !== '' && paths.length >= minimum)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

    for (const [key, paths] of ordered) {
      const name = folderName(key)
      // Do not invent a folder that already exists - that is rule 1's job, and
      // it already declined.
      if (byNormalisedName.has(normalise(name))) continue
      const remaining = paths.filter((path) => undecided.includes(path))
      if (remaining.length < minimum) continue
      for (const path of remaining) {
        moves.push({ path, into: name, creates: true, reason: label(key) })
        undecided.splice(undecided.indexOf(path), 1)
      }
      byNormalisedName.set(normalise(name), name)
    }
  }

  group(
    (path) => (input.context.get(path)?.tags ?? []).map((tag) => normalise(tag)),
    MIN_FOR_TAG_FOLDER,
    (key) => `grouped by #${key}`,
  )
  group(nameTokens, MIN_FOR_NAME_FOLDER, (key) => `grouped by “${key}” in the name`)

  for (const path of undecided) {
    skipped.push({ path, reason: 'no tags, links or shared words to go on' })
  }

  moves.sort((a, b) => a.into.localeCompare(b.into) || a.path.localeCompare(b.path))
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  return { moves, skipped }
}
