import { Annotation, StateEffect, StateField, type ChangeDesc, type Text, type Transaction } from '@codemirror/state'

/**
 * Who wrote which part of a note: you, an AI, or a reference you pasted in -
 * iA Writer's authorship.
 *
 * Everything is yours unless marked otherwise, so only the other two are
 * stored. A range follows the text as the note is edited, and whatever you
 * type INSIDE an AI or reference passage is yours: the passage splits around
 * it. That is the rule that makes authorship honest - editing a generated
 * paragraph turns the words you changed back into your own.
 *
 * Text arrives as AI or reference only through a transaction carrying
 * `authorAnnotation` (paste-as, mark-selection, and later the bots that write
 * into notes). Stored outside the note, in `.recto/authors.json`, so a note
 * stays plain markdown and syncing it to Obsidian adds nothing to the file.
 */

export type Author = 'ai' | 'reference'

export type AuthorRange = { from: number; to: number; author: Author }

/** Marks the text a transaction inserts - or, with no insert, the selection - as by this author, or human. */
export const authorAnnotation = Annotation.define<Author | 'human'>()

/** Replace every range, e.g. when a note's saved authorship is loaded. */
export const setAuthorRanges = StateEffect.define<AuthorRange[]>()

/** Merge touching ranges by the same author and drop empty ones. */
export function normalise(ranges: readonly AuthorRange[]): AuthorRange[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const out: AuthorRange[] = []
  for (const range of sorted) {
    const last = out[out.length - 1]
    if (last !== undefined && last.author === range.author && range.from <= last.to) {
      last.to = Math.max(last.to, range.to)
    } else if (last !== undefined && range.from < last.to) {
      // Overlap by a different author: the later mark wins its part.
      last.to = range.from
      out.push({ ...range })
    } else {
      out.push({ ...range })
    }
  }
  return out.filter((r) => r.to > r.from)
}

/** Remove a span from every range, splitting where it falls inside one. */
export function subtract(ranges: readonly AuthorRange[], from: number, to: number): AuthorRange[] {
  const out: AuthorRange[] = []
  for (const range of ranges) {
    if (to <= range.from || from >= range.to) {
      out.push(range)
      continue
    }
    if (range.from < from) out.push({ ...range, to: from })
    if (range.to > to) out.push({ ...range, from: to })
  }
  return out
}

/**
 * Carry ranges through an edit.
 *
 * Ends map inward (a range does not grow to swallow text typed at its edge),
 * then every newly inserted span is cut out of whatever range it landed in -
 * so typing in the middle of an AI paragraph splits it rather than extending
 * it. If the edit is annotated, the inserted text is then added back under
 * that author.
 */
export function mapRanges(ranges: readonly AuthorRange[], changes: ChangeDesc, author: Author | 'human' | undefined): AuthorRange[] {
  let mapped: AuthorRange[] = ranges.map((r) => ({ ...r, from: changes.mapPos(r.from, 1), to: changes.mapPos(r.to, -1) }))
  const inserted: { from: number; to: number }[] = []
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (toB > fromB) inserted.push({ from: fromB, to: toB })
  })
  for (const span of inserted) mapped = subtract(mapped, span.from, span.to)
  if (author !== undefined && author !== 'human') {
    for (const span of inserted) mapped.push({ ...span, author })
  }
  return normalise(mapped)
}

export const authorField = StateField.define<AuthorRange[]>({
  create: () => [],
  update(ranges, tr: Transaction) {
    let next = ranges
    for (const effect of tr.effects) if (effect.is(setAuthorRanges)) next = normalise(effect.value)
    const author = tr.annotation(authorAnnotation)
    if (tr.docChanged) next = mapRanges(next, tr.changes, author)
    // An annotation with no text change re-marks the selection.
    if (!tr.docChanged && author !== undefined) {
      let marked = next
      for (const range of tr.state.selection.ranges) {
        if (range.empty) continue
        marked = subtract(marked, range.from, range.to)
        if (author !== 'human') marked.push({ from: range.from, to: range.to, author })
      }
      next = normalise(marked)
    }
    return next
  },
})

// --- saving --------------------------------------------------------------------------

export type StoredRange = AuthorRange & { text: string }

/** What to save: each range with its text, so it can be found again if the file changes elsewhere. */
export const toStored = (doc: Text, ranges: readonly AuthorRange[]): StoredRange[] =>
  ranges.map((r) => ({ ...r, text: doc.sliceString(r.from, r.to) }))

/**
 * Put saved ranges back on a document.
 *
 * Where the text is still exactly where it was, it is used as is. If the note
 * was edited in another app, each passage is looked for nearest its old place;
 * one that is gone is dropped rather than guessed at - marking the wrong words
 * as AI is worse than forgetting a mark.
 */
export function fromStored(doc: Text, stored: readonly StoredRange[]): AuthorRange[] {
  const text = doc.toString()
  const out: AuthorRange[] = []
  for (const range of stored) {
    if (range.text === '' || (range.author !== 'ai' && range.author !== 'reference')) continue
    if (text.slice(range.from, range.to) === range.text) {
      out.push({ from: range.from, to: range.to, author: range.author })
      continue
    }
    let best = -1
    for (let at = text.indexOf(range.text); at !== -1; at = text.indexOf(range.text, at + 1)) {
      if (best === -1 || Math.abs(at - range.from) < Math.abs(best - range.from)) best = at
    }
    if (best !== -1) out.push({ from: best, to: best + range.text.length, author: range.author })
  }
  return normalise(out)
}
