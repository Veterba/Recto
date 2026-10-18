import { autocompletion, insertCompletionText, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import { noteIndexChanged } from '../../app/note-bus'
import { highlightCompletion } from './highlights'

/**
 * `[[` autocomplete for note names - and the one autocomplete of the editor:
 * every list it shows (`==` highlight colours too) is the same glass layer as
 * the find bar (styles/complete.css).
 *
 * Candidates come from a callback rather than being baked in: the vault's
 * notes change while the editor stays open.
 */

export type LinkCandidate = { path: string; name: string; folder: string }

/** A completion that shows a folder after its name. */
type NoteCompletion = Completion & { folder?: string }

/** Matches an unfinished wikilink at the cursor: `[[par` with no closing `]]`. */
const OPEN_LINK = /\[\[([^\]\n]*)$/

/** How long a folder path may be before its middle gives way to an ellipsis. */
const PATH_CHARS = 36

/** `Programming/Projects/Recto app` -> `Programmin…/Recto app`: both ends kept, the middle cut. */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text
  const tail = Math.floor((max - 1) / 2)
  const head = max - 1 - tail
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

function renderFolder(completion: NoteCompletion): Node | null {
  if (completion.folder === undefined) return null
  const span = document.createElement('span')
  span.className = 'cm-completionPath'
  span.textContent = middleEllipsis(completion.folder, PATH_CHARS)
  span.title = completion.folder
  return span
}

function renderCreate(completion: Completion): Node | null {
  if (completion.type !== 'create') return null
  const span = document.createElement('span')
  span.className = 'cm-completionPlus'
  span.textContent = '+'
  return span
}

/**
 * The editor's width as a CSS variable on it, for the list: it fits its rows,
 * but is never wider than the editor it opens in.
 */
const editorWidth = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure()
    }
    update(update: { geometryChanged: boolean }): void {
      if (update.geometryChanged) this.measure()
    }
    measure(): void {
      this.view.requestMeasure({
        read: (view) => view.dom.clientWidth,
        write: (width, view) => view.dom.style.setProperty('--cm-editor-width', `${width}px`),
      })
    }
  },
)

/** A new, empty note at the vault's top, for a link to a name no note has yet. */
async function createNote(name: string): Promise<void> {
  const created = await api.invoke(IPC.fsCreate, '', `${name}.md`, 'file', 'refuse')
  if (created.ok) noteIndexChanged()
}

export function linkCompletion(getCandidates: () => readonly LinkCandidate[]): Extension {
  return [
    editorWidth,
    autocompletion({
      override: [
        (context: CompletionContext): CompletionResult | null => {
          const before = context.state.doc.sliceString(Math.max(0, context.pos - 200), context.pos)
          const match = OPEN_LINK.exec(before)
          if (!match) return null

          const typed = match[1] ?? ''
          // Once a '#' or '|' is typed the user is past the note name.
          if (typed.includes('#') || typed.includes('|')) return null

          const from = context.pos - typed.length
          const candidates = getCandidates()
          // Brackets that are already closed after the cursor - `[[|]]`, the shape
          // you get from typing both pairs first - must not be closed again. That
          // is how `[[Recto]]]]` got into a real vault.
          const after = context.state.doc.sliceString(context.pos, context.pos + 2)
          const close = after === ']]' ? '' : ']]'

          const options: NoteCompletion[] = candidates.map((candidate) => ({
            label: candidate.name,
            ...(candidate.folder === '' ? {} : { folder: candidate.folder }),
            // Close the brackets on accept, so the link is complete rather
            // than leaving the user to type ']]' themselves - unless they
            // already did.
            apply: `${candidate.name}${close}`,
          }))

          // No note has this name yet: the last row makes one. Names are
          // unique in the vault ignoring case, so that is how they are compared.
          const name = typed.trim()
          if (name !== '' && !candidates.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            options.push({
              label: `Create “${name}”`,
              type: 'create',
              boost: -99,
              apply: (view, _completion, start, end) => {
                view.dispatch(insertCompletionText(view.state, `${name}${close}`, start, end))
                void createNote(name)
              },
            })
          }

          return {
            from,
            options,
            // CodeMirror filters and ranks the list; re-filtering here would mean
            // two competing notions of "best match". No `validFor`: the source
            // runs again on every keystroke, so the Create row names what is
            // typed now.
            filter: true,
          }
        },
        // `==` offers the highlight colours (highlights.ts).
        highlightCompletion,
      ],
      // The list is note names, not code: showing it on every keystroke outside a
      // link would be noise.
      activateOnTyping: true,
      closeOnBlur: true,
      icons: false,
      tooltipClass: () => 'glass-surface',
      optionClass: (completion) => (completion.type === 'create' ? 'cm-completion-create' : ''),
      addToOptions: [
        { render: renderCreate, position: 20 },
        { render: renderFolder, position: 80 },
      ],
    }),
  ]
}
