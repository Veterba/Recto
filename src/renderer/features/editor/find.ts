import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  selectNextOccurrence,
  setSearchQuery,
} from '@codemirror/search'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, runScopeHandlers, type KeyBinding, type Panel, type ViewUpdate } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'

/**
 * Find and replace in the open note.
 *
 * CodeMirror's search state does the work - the query, the highlighting of
 * every match, next and previous, replace - and this file supplies the bar it
 * is driven from. The stock panel was a form with unlabelled checkboxes and no
 * count, and its ⌘F lived in a keymap that raced the app's own ⌘F; see
 * `editor-commands.ts` for who owns the chord now.
 */

/** Matches counted, and marked on the scrollbar, before the count gives up. */
export const MATCH_LIMIT = 1000

type Match = { from: number; to: number }

/**
 * How many matches there are, and which one the selection is on.
 *
 * `current` is 1-based and null when the selection is not exactly a match -
 * after typing in the note, say - so the bar never claims a position it is
 * not at.
 */
export function countMatches(
  state: EditorState,
  query: SearchQuery,
  limit = MATCH_LIMIT,
): { total: number; current: number | null; capped: boolean } {
  if (!query.valid) return { total: 0, current: null, capped: false }
  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current: number | null = null
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (total === limit) return { total, current, capped: true }
    total++
    if (next.value.from === from && next.value.to === to) current = total
  }
  return { total, current, capped: false }
}

/** The first match at or after `pos`, wrapping round to the top. */
export function firstMatchFrom(state: EditorState, query: SearchQuery, pos: number): Match | null {
  if (!query.valid) return null
  let next = query.getCursor(state, pos).next()
  if (next.done) next = query.getCursor(state, 0, pos).next()
  return next.done ? null : { from: next.value.from, to: next.value.to }
}

/** The counter's text: `n / N`, with a dash while the selection is not on a match. */
export function countLabel({ total, current, capped }: ReturnType<typeof countMatches>, query: SearchQuery): string {
  if (query.search === '') return ''
  if (!query.valid) return 'Invalid'
  return `${current ?? (total === 0 ? 0 : '–')} / ${capped ? `${total}+` : total}`
}

/**
 * Where each match's tick sits on the scrollbar, as a fraction of its height.
 *
 * `tops` are the matches' offsets from the top of the document; `offset` is
 * how far the document starts below the top of the scrolled content, and
 * `height` is the scrolled content's full height. Ticks that would land on the
 * same pixel row are merged, so a note full of matches does not become a
 * thousand elements for a column of 600 pixels.
 */
export function markerFractions(tops: readonly number[], offset: number, height: number, rows: number): number[] {
  if (height <= 0) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const top of tops) {
    const fraction = Math.min(1, Math.max(0, (offset + top) / height))
    const row = Math.round(fraction * rows)
    if (seen.has(row)) continue
    seen.add(row)
    out.push(fraction)
  }
  return out
}

const escapeRegExp = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/** Whether the replace row is showing: ⌘⌥F shows it, ⌘F hides it again. */
const setReplaceShown = StateEffect.define<boolean>()
const replaceShown = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setReplaceShown)) value = effect.value
    return value
  },
})

/** How long the card takes to leave; it is removed once it has. */
const CLOSE_MS = 140
/** A close in progress, per editor, so reopening can call it off. */
const closing = new WeakMap<EditorView, number>()

/**
 * Open the card, or bring focus back to it.
 *
 * A single-line selection becomes the query; anything else keeps the last
 * query, so ⌘F, Esc, ⌘F picks up where it was.
 */
export function openFind(view: EditorView, replace: boolean): void {
  const pending = closing.get(view)
  if (pending !== undefined) {
    window.clearTimeout(pending)
    closing.delete(view)
    view.dom.querySelector('.find')?.classList.remove('is-closing')
  }
  const previous = getSearchQuery(view.state)
  const { from, to, empty } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const prefill = !empty && !selected.includes('\n') ? (previous.regexp ? escapeRegExp(selected) : selected) : null
  // Opening dispatches a query of its own, taken from the selection without
  // escaping it for a regex; the one below replaces it.
  openSearchPanel(view)
  view.dispatch({
    effects: [
      setSearchQuery.of(
        new SearchQuery({
          search: prefill ?? previous.search,
          caseSensitive: previous.caseSensitive,
          wholeWord: previous.wholeWord,
          regexp: previous.regexp,
          replace: previous.replace,
          literal: true,
        }),
      ),
      setReplaceShown.of(replace),
    ],
  })
  const card = view.dom.querySelector('.find')
  const field = card?.querySelector<HTMLInputElement>(replace && prefill !== null ? '.find__input--replace' : '.find__input--find')
  field?.focus()
  field?.select()
}

/**
 * Close the card and hand the keyboard back to the note, the current match
 * still selected - or, in Vim, the cursor on its first letter, since a
 * selection there is visual mode and the next keystroke would act on it.
 *
 * The keyboard goes back at once; the card itself plays its exit and is
 * removed after it, since CodeMirror would take it out of the page mid-frame.
 */
function closeFind(view: EditorView): boolean {
  if (!searchPanelOpen(view.state)) return false
  if (closing.has(view)) return true
  view.focus()
  const vimState = (getCM(view)?.state as { vim?: unknown } | undefined)?.vim
  if (vimState != null && !view.state.selection.main.empty) {
    view.dispatch({ selection: { anchor: view.state.selection.main.from } })
  }
  view.dom.querySelector('.find')?.classList.add('is-closing')
  closing.set(
    view,
    window.setTimeout(() => {
      closing.delete(view)
      closeSearchPanel(view)
    }, CLOSE_MS),
  )
  return true
}

/** Select the first match from the caret, as the query is typed. */
function selectFirstMatch(view: EditorView): void {
  const query = getSearchQuery(view.state)
  const match = firstMatchFrom(view.state, query, view.state.selection.main.from)
  if (match === null) return
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    userEvent: 'select.search',
  })
}

const SVG = 'http://www.w3.org/2000/svg'
/** Lucide's chevrons and x, drawn here because the panel is not React. */
function icon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({
    width: '16',
    height: '16',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value)
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

function button(className: string, label: string, content: string | SVGSVGElement, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.title = label
  el.setAttribute('aria-label', label)
  el.append(content)
  // Keep focus in the field: a click on a toggle should not leave the typing.
  el.addEventListener('mousedown', (event) => event.preventDefault())
  el.addEventListener('click', onClick)
  return el
}

const div = (className: string, ...children: (HTMLElement | SVGSVGElement)[]): HTMLDivElement => {
  const el = document.createElement('div')
  el.className = className
  el.append(...children)
  return el
}

/**
 * The card: a find field with its count, a replace field when replacing, and
 * a row of tools - the query's toggles and close on the left, and on the right
 * the action Enter would take, as the pill.
 */
function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'find glass-surface'
  dom.setAttribute('role', 'search')

  const field = (kind: 'find' | 'replace', placeholder: string): HTMLInputElement => {
    const input = document.createElement('input')
    input.className = `find__input find__input--${kind}`
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    input.spellcheck = false
    return input
  }
  const findField = field('find', 'Find in note')
  // CodeMirror focuses the `main-field` when it opens the panel itself.
  findField.setAttribute('main-field', 'true')
  const replaceField = field('replace', 'Replace with')
  const count = document.createElement('span')
  count.className = 'find__count'
  count.setAttribute('aria-live', 'polite')

  const toggles = {
    caseSensitive: button('find__tool find__toggle', 'Match case', 'Aa', () => flip('caseSensitive')),
    wholeWord: button('find__tool find__toggle', 'Whole word', 'W', () => flip('wholeWord')),
    regexp: button('find__tool find__toggle', 'Regular expression', '.*', () => flip('regexp')),
  }

  const query = (): SearchQuery =>
    new SearchQuery({
      search: findField.value,
      replace: replaceField.value,
      caseSensitive: toggles.caseSensitive.getAttribute('aria-pressed') === 'true',
      wholeWord: toggles.wholeWord.getAttribute('aria-pressed') === 'true',
      regexp: toggles.regexp.getAttribute('aria-pressed') === 'true',
      literal: true,
    })
  const commit = (): boolean => {
    const next = query()
    if (next.eq(getSearchQuery(view.state))) return false
    view.dispatch({ effects: setSearchQuery.of(next) })
    return true
  }
  const flip = (name: keyof typeof toggles): void => {
    const el = toggles[name]
    el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'))
    if (commit()) selectFirstMatch(view)
  }

  findField.addEventListener('input', () => {
    if (commit()) selectFirstMatch(view)
  })
  replaceField.addEventListener('input', commit)

  const keydown = (event: KeyboardEvent): void => {
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault()
      return
    }
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (event.target === replaceField) replaceNext(view)
    else if (event.shiftKey) findPrevious(view)
    else findNext(view)
  }
  findField.addEventListener('keydown', keydown)
  replaceField.addEventListener('keydown', keydown)

  const replaceRow = div('find__row find__row--replace', replaceField)
  const navigate = div(
    'find__actions',
    button('find__tool', 'Previous match (⇧↵)', icon(['m18 15-6-6-6 6']), () => findPrevious(view)),
    button('find__pill', 'Next match (↵)', icon(['m6 9 6 6 6-6']), () => findNext(view)),
  )
  const replaceActions = div(
    'find__actions',
    button('find__secondary', 'Replace all', 'All', () => replaceAll(view)),
    button('find__pill', 'Replace (↵)', 'Replace', () => replaceNext(view)),
  )
  dom.append(
    div('find__row', findField, count),
    replaceRow,
    div(
      'find__tools',
      toggles.caseSensitive,
      toggles.wholeWord,
      toggles.regexp,
      button('find__tool', 'Close (Esc)', icon(['M18 6 6 18', 'm6 6 12 12']), () => closeFind(view)),
      navigate,
      replaceActions,
    ),
  )

  /** Put the query's text and toggles into the card, when it came from elsewhere. */
  const show = (q: SearchQuery): void => {
    if (findField.value !== q.search) findField.value = q.search
    if (replaceField.value !== q.replace) replaceField.value = q.replace
    toggles.caseSensitive.setAttribute('aria-pressed', String(q.caseSensitive))
    toggles.wholeWord.setAttribute('aria-pressed', String(q.wholeWord))
    toggles.regexp.setAttribute('aria-pressed', String(q.regexp))
    findField.setAttribute('aria-invalid', String(q.search !== '' && !q.valid))
  }
  const recount = (state: EditorState): void => {
    const q = getSearchQuery(state)
    count.textContent = countLabel(countMatches(state, q), q)
  }
  const showReplace = (state: EditorState): void => {
    const on = state.field(replaceShown)
    replaceRow.hidden = !on
    replaceActions.hidden = !on
    navigate.hidden = on
  }

  show(getSearchQuery(view.state))
  recount(view.state)
  showReplace(view.state)

  return {
    dom,
    // At the bottom: styled to float there over the text, and CodeMirror
    // counts a bottom panel's height as a scroll margin, which is what keeps
    // the current match above the card rather than behind it.
    top: false,
    mount: () => {
      findField.focus()
      findField.select()
    },
    update: (update: ViewUpdate) => {
      const queried = update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
      if (queried) show(getSearchQuery(update.state))
      if (queried || update.docChanged || update.selectionSet) recount(update.state)
      if (update.startState.field(replaceShown) !== update.state.field(replaceShown)) showReplace(update.state)
    },
  }
}

/**
 * Every match marked on the scrollbar, so you can see where in a long note
 * they are before scrolling there.
 */
const scrollbarMarks = ViewPlugin.fromClass(
  class {
    track: HTMLDivElement
    constructor(readonly view: EditorView) {
      this.track = document.createElement('div')
      this.track.className = 'find-marks'
      this.track.setAttribute('aria-hidden', 'true')
      view.dom.append(this.track)
      this.schedule()
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.geometryChanged ||
        searchPanelOpen(update.startState) !== searchPanelOpen(update.state) ||
        getSearchQuery(update.startState) !== getSearchQuery(update.state)
      )
        this.schedule()
    }
    schedule(): void {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const query = getSearchQuery(view.state)
          if (!searchPanelOpen(view.state) || !query.valid) return null
          const tops: number[] = []
          const cursor = query.getCursor(view.state)
          for (let next = cursor.next(); !next.done && tops.length < MATCH_LIMIT; next = cursor.next()) {
            tops.push(view.lineBlockAt(next.value.from).top)
          }
          const scroller = view.scrollDOM
          const offset = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop
          return {
            top: scroller.offsetTop,
            height: scroller.clientHeight,
            fractions: markerFractions(tops, offset, scroller.scrollHeight, scroller.clientHeight),
          }
        },
        write: (measured) => {
          this.track.replaceChildren()
          this.track.hidden = measured === null
          if (measured === null) return
          this.track.style.top = `${measured.top}px`
          this.track.style.height = `${measured.height}px`
          for (const fraction of measured.fractions) {
            const tick = document.createElement('div')
            tick.className = 'find-marks__tick'
            tick.style.top = `${fraction * 100}%`
            this.track.append(tick)
          }
        },
      })
    }
    destroy(): void {
      this.track.remove()
    }
  },
)

/**
 * The search keymap, minus what the app binds itself.
 *
 * ⌘F and ⌘⌥F are commands in the registry (`editor:find`, `editor:replace`),
 * so they are listed and rebindable with everything else. ⌘G / ⇧⌘G are left
 * out: they are the graph's. ⌘⇧L is left out too - CodeMirror's "select all
 * matches" and the app's theme cycle both ran on it.
 */
export const FIND_BINDINGS: readonly KeyBinding[] = [
  { key: 'F3', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
  { key: 'Escape', run: closeFind, scope: 'editor search-panel' },
  { key: 'Mod-Alt-g', run: gotoLine },
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
]

export const findInNote = (): Extension => [
  search({ literal: true, createPanel: createFindPanel }),
  replaceShown,
  scrollbarMarks,
  keymap.of(FIND_BINDINGS),
]
