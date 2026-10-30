import { useEffect } from 'react'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { historyChanged, placeOf, setRestore, setTabHistoryHandler, travel } from '../tab-history'

/**
 * Travelling through a tab's history, for the whole shell: the ← and →
 * buttons, ⌘[ and ⌘] (register-commands.ts), and the mouse's own back and
 * forward buttons. A step carries where in it you were; the view lands back
 * there (takeRestore).
 */
export function useTabHistory(sections: WorkspaceApi['sections'], activeSection: SectionId): void {
  useEffect(() => {
    if (sections === null) return
    const all = Object.values(sections)
    const holding = (leafId: string): (typeof all)[number] | null => all.find((workspace) => workspace.getLeaf(leafId) !== null) ?? null

    setTabHistoryHandler({
      history: (leafId) => holding(leafId)?.getLeaf(leafId)?.history,
      travel: (leafId, steps, newTab) => {
        const workspace = holding(leafId)
        if (workspace === null) return
        if (newTab) {
          // The step opens beside this tab, which stays where it is.
          const history = workspace.getLeaf(leafId)?.history
          const entry = (steps < 0 ? history?.back : history?.forward)?.[Math.abs(steps) - 1]
          if (entry === undefined) return
          const opened = workspace.openView(entry.type, entry.state, { reuse: false })
          setRestore(opened.id, entry.at)
          return
        }
        setRestore(leafId, workspace.travel(leafId, steps, placeOf(leafId))?.at)
      },
      step: (leafId, type, state) => {
        const at = placeOf(leafId)
        holding(leafId)?.navigate(leafId, { type, state }, at === undefined ? {} : { at })
      },
    })
    const refs = all.map((workspace) => workspace.on('layout-change', historyChanged))
    return () => {
      setTabHistoryHandler(null)
      for (const ref of refs) ref.detach()
    }
  }, [sections])

  // A mouse's back and forward buttons (4 and 5) move the tab you are in.
  useEffect(() => {
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return
      const leaf = sections?.[activeSection].activeLeaf
      if (leaf == null) return
      event.preventDefault()
      travel(leaf.id, event.button === 3 ? -1 : 1)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [sections, activeSection])
}
