import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

/**
 * `[[` autocomplete for note names.
 *
 * Candidates come from a callback rather than being baked in, so this module
 * stays ignorant of the vault - it is the editor's job to render a list, not to
 * know what a note is.
 */

export type LinkCandidate = { path: string; name: string; folder: string }

/** Matches an unfinished wikilink at the cursor: `[[par` with no closing `]]`. */
const OPEN_LINK = /\[\[([^\]\n]*)$/

export function linkCompletion(getCandidates: () => readonly LinkCandidate[]): Extension {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const before = context.state.doc.sliceString(
          Math.max(0, context.pos - 200),
          context.pos,
        )
        const match = OPEN_LINK.exec(before)
        if (!match) return null

        const typed = match[1] ?? ''
        // Once a '#' or '|' is typed the user is past the note name.
        if (typed.includes('#') || typed.includes('|')) return null

        const from = context.pos - typed.length
        const candidates = getCandidates()

        return {
          from,
          options: candidates.map((candidate) => ({
            label: candidate.name,
            ...(candidate.folder === '' ? {} : { detail: candidate.folder }),
            type: 'text',
            // Close the brackets on accept, so the link is complete rather
            // than leaving the user to type ']]' themselves.
            apply: `${candidate.name}]]`,
          })),
          // CodeMirror filters and ranks the list; re-filtering here would mean
          // two competing notions of "best match".
          filter: true,
          validFor: /^[^\]\n#|]*$/,
        }
      },
    ],
    // The list is note names, not code: showing it on every keystroke outside a
    // link would be noise.
    activateOnTyping: true,
    closeOnBlur: true,
  })
}
