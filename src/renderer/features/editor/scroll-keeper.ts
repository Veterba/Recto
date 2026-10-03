import { EditorView } from '@codemirror/view'

/**
 * Where every open editor is scrolled to, kept by document position rather
 * than pixels, and put back later.
 *
 * Focus mode folds the other panes to nothing and widens the one being
 * written in; both rewrap their lines, and a pixel scroll offset then points
 * at different text. So what is kept is the line at the top of the view and
 * how far into it the view starts, and it is put back inside CodeMirror's
 * measure cycle. The pixel offset itself may differ afterwards - a pane folded
 * to nothing leaves CodeMirror with taller estimates for lines above the view
 * until it draws them again - but the same text is at the top.
 */

export type ScrollSnapshot = {
  view: EditorView
  /** The document position at the top of the view, and how many pixels into its line block the view begins. */
  pos: number
  offset: number
  /** The state when it was taken: to tell whether anything was written since. */
  state: EditorView['state']
}

/** Nothing typed and the cursor not moved since the snapshot. */
export const untouchedSince = (snapshot: ScrollSnapshot): boolean =>
  snapshot.view.state.doc === snapshot.state.doc && snapshot.view.state.selection.eq(snapshot.state.selection)

/** Where the document starts inside the scroller's content, in pixels (the editor's top padding). */
const documentOffset = (view: EditorView): number =>
  view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop

export function snapshotOf(view: EditorView): ScrollSnapshot {
  const top = view.scrollDOM.scrollTop - documentOffset(view)
  const block = view.lineBlockAtHeight(Math.max(0, top))
  return { view, pos: block.from, offset: top - block.top, state: view.state }
}

/** Every editor on the page (or those whose element passes `which`), as it is scrolled now. */
export function snapshotEditors(which: (dom: HTMLElement) => boolean = () => true): ScrollSnapshot[] {
  const out: ScrollSnapshot[] = []
  for (const dom of document.querySelectorAll<HTMLElement>('.cm-editor')) {
    if (!which(dom)) continue
    const view = EditorView.findFromDOM(dom)
    if (view !== null) out.push(snapshotOf(view))
  }
  return out
}

/** Scroll each editor back to its snapshot - those still open. Measures, scrolls, and repeats until it holds. */
export function restoreEditors(snapshots: readonly ScrollSnapshot[], tries = 4): void {
  for (const snapshot of snapshots) {
    const { view } = snapshot
    if (!view.dom.isConnected) continue
    const step = (left: number): void =>
      view.requestMeasure({
        read: (v) => documentOffset(v) + v.lineBlockAt(Math.min(snapshot.pos, v.state.doc.length)).top + snapshot.offset,
        write: (target, v) => {
          if (Math.abs(v.scrollDOM.scrollTop - target) < 1) return
          v.scrollDOM.scrollTop = target
          // Scrolling draws new lines and measures them; the target can move once more.
          if (left > 1) requestAnimationFrame(() => step(left - 1))
        },
      })
    step(tries)
  }
}

/** How long the panes take to fold and unfold (writing.css: flex-basis 420ms), and a frame more. */
const PANES_MS = 460

let atEntry: ScrollSnapshot[] = []
let pending: number | undefined

/**
 * Focus mode is about to begin or end. Entering, every pane's scroll is
 * noted. Leaving, once the panes have unfolded, each is scrolled back to where
 * it was - except a pane that was written in, which keeps its cursor in view.
 */
export function focusModeChanging(entering: boolean): void {
  window.clearTimeout(pending)
  if (entering) {
    atEntry = snapshotEditors()
    return
  }
  const touched = atEntry.filter((s) => s.view.dom.isConnected && !untouchedSince(s)).map((s) => s.view)
  const now = snapshotEditors((dom) => touched.some((view) => view.dom === dom))
  const back = [...atEntry.filter((s) => !touched.includes(s.view)), ...now]
  atEntry = []
  pending = window.setTimeout(() => restoreEditors(back), PANES_MS)
}
