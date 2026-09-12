import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { DEFAULT_SECTION, isSectionId, SECTIONS, type SectionId } from './sections'
import { clampGeometry, type WindowGeometry } from '../components/FloatingWindow'
import { Workspace, type WorkspaceLayout } from './workspace'

/**
 * One workspace per section, all persisted to workspace.json.
 *
 * Switching section swaps the whole tree - tabs, splits, active leaf - so the
 * notes you had open are still there when you come back from the board. Keeping
 * a single shared tree instead would mean either wiping tabs on every switch or
 * mixing boards and notes in one tab bar; both are worse.
 */

export type Sections = Record<SectionId, Workspace>

type SavedFile = {
  version: 2
  sections: Partial<Record<SectionId, WorkspaceLayout>>
  activeSection: SectionId
  /** Floating graph window, shared across sections. */
  graphWindow?: { open: boolean } & Partial<WindowGeometry>
  /** Floating version-history window. */
  historyWindow?: { open: boolean } & Partial<WindowGeometry>
}

export type GraphWindowState = { open: boolean } & WindowGeometry

export const GRAPH_WINDOW_DEFAULT: GraphWindowState = {
  open: false,
  x: 420,
  y: 60,
  width: 380,
  height: 420,
  maximized: false,
}

export const HISTORY_WINDOW_DEFAULT: GraphWindowState = {
  open: false,
  x: 180,
  y: 80,
  width: 620,
  height: 460,
  maximized: false,
}

function parse(saved: unknown): {
  layouts: Partial<Record<SectionId, WorkspaceLayout>>
  active: SectionId
  graphWindow: GraphWindowState
  historyWindow: GraphWindowState
} {
  const fallback = {
    layouts: {},
    active: DEFAULT_SECTION,
    graphWindow: GRAPH_WINDOW_DEFAULT,
    historyWindow: HISTORY_WINDOW_DEFAULT,
  }
  if (typeof saved !== 'object' || saved === null) return fallback

  const file = saved as Partial<SavedFile>
  // A v1 file held a single layout. Rather than migrate it into a guessed
  // section, drop it: it is a tab list, not user content, and it rebuilds in
  // one click. Silently mis-homing someone's tabs is worse than a clean start.
  if (file.version !== 2) return fallback

  return {
    layouts: file.sections ?? {},
    active: isSectionId(file.activeSection) ? file.activeSection : DEFAULT_SECTION,
    graphWindow: { ...GRAPH_WINDOW_DEFAULT, ...file.graphWindow, open: file.graphWindow?.open ?? false },
    historyWindow: {
      ...HISTORY_WINDOW_DEFAULT,
      ...file.historyWindow,
      open: file.historyWindow?.open ?? false,
    },
  }
}

export type WorkspaceApi = {
  sections: Sections | null
  active: Workspace | null
  activeSection: SectionId
  setActiveSection: (id: SectionId) => void
  graphWindow: GraphWindowState
  setGraphWindow: (next: Partial<GraphWindowState>) => void
  historyWindow: GraphWindowState
  setHistoryWindow: (next: Partial<GraphWindowState>) => void
  revision: number
}

export function useWorkspace(): WorkspaceApi {
  const [sections, setSections] = useState<Sections | null>(null)
  const [activeSection, setActive] = useState<SectionId>(DEFAULT_SECTION)
  const [graphWindow, setWindow] = useState(GRAPH_WINDOW_DEFAULT)
  const [historyWindow, setHistory] = useState(HISTORY_WINDOW_DEFAULT)
  const [revision, setRevision] = useState(0)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void api.invoke('state:read', 'workspace').then((saved) => {
      if (cancelled) return
      const { layouts, active, graphWindow: win, historyWindow: hist } = parse(saved)
      const built = Object.fromEntries(
        SECTIONS.map((section) => [section.id, new Workspace(layouts[section.id])]),
      ) as Sections
      setSections(built)
      setActive(active)
      setWindow(win)
      setHistory(hist)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const serialize = useCallback(
    (current: Sections, active: SectionId, windows: { graph: GraphWindowState; history: GraphWindowState }): SavedFile => ({
      version: 2,
      sections: Object.fromEntries(
        SECTIONS.map((section) => [section.id, current[section.id].serialize()]),
      ) as SavedFile['sections'],
      activeSection: active,
      graphWindow: windows.graph,
      historyWindow: windows.history,
    }),
    [],
  )

  const save = useCallback(
    (current: Sections, active: SectionId, windows: { graph: GraphWindowState; history: GraphWindowState }) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void api.invoke('state:write', 'workspace', serialize(current, active, windows))
      }, 400)
    },
    [serialize],
  )

  /**
   * The newest state, for the subscription and the teardown flush to read.
   *
   * This is a ref rather than a dependency on purpose. An earlier version had
   * the subscription effect depend on `activeSection` and `graphWindow`, and
   * flush `serialize(...)` in its cleanup. Every change therefore re-ran the
   * effect, whose cleanup cancelled the pending (correct) debounced write and
   * then wrote the value from its own now-stale closure - so each change
   * persisted the *previous* state. A "never lose the last change" safety net
   * that reliably lost the last change.
   */
  const latest = useRef({ sections, activeSection, graphWindow, historyWindow })
  latest.current = { sections, activeSection, graphWindow, historyWindow }

  /** Both floating windows, as the save functions want them. */
  const windowsOf = (state: typeof latest.current): { graph: GraphWindowState; history: GraphWindowState } => ({
    graph: state.graphWindow,
    history: state.historyWindow,
  })

  useEffect(() => {
    if (!sections) return
    const refs = SECTIONS.map((section) =>
      sections[section.id].on('layout-change', () => {
        setRevision((n) => n + 1)
        const now = latest.current
        if (now.sections) save(now.sections, now.activeSection, windowsOf(now))
      }),
    )
    return () => {
      refs.forEach((ref) => ref.detach())
      window.clearTimeout(saveTimer.current)
      // Flush on unmount so quitting never loses the last change - from the ref,
      // so it is the newest state and not whatever this closure captured.
      const now = latest.current
      if (now.sections) {
        void api.invoke('state:write', 'workspace', serialize(now.sections, now.activeSection, windowsOf(now)))
      }
    }
  }, [sections, save, serialize])

  const setActiveSection = useCallback(
    (id: SectionId) => {
      setActive(id)
      setRevision((n) => n + 1)
      if (sections) save(sections, id, { graph: graphWindow, history: historyWindow })
    },
    [sections, graphWindow, historyWindow, save],
  )

  /** Shared by both floating windows; they differ only in which state they set. */
  const makeSetter = (
    setter: typeof setWindow,
    pick: (next: GraphWindowState) => { graph: GraphWindowState; history: GraphWindowState },
  ) =>
    (patch: Partial<GraphWindowState>): void => {
      setter((prev) => {
        // Clamp on write, not just on drag: a hand-edited workspace.json could
        // otherwise park a window permanently off-screen.
        const next = clampGeometry({ ...prev, ...patch }, { width: window.innerWidth, height: window.innerHeight })
        const merged = { ...next, open: patch.open ?? prev.open }
        if (sections) save(sections, activeSection, pick(merged))
        return merged
      })
    }

  const setGraphWindow = useCallback(
    makeSetter(setWindow, (next) => ({ graph: next, history: latest.current.historyWindow })),
    [sections, activeSection, save],
  )

  const setHistoryWindow = useCallback(
    makeSetter(setHistory, (next) => ({ graph: latest.current.graphWindow, history: next })),
    [sections, activeSection, save],
  )

  const active = useMemo(() => (sections ? sections[activeSection] : null), [sections, activeSection])

  return {
    sections,
    active,
    activeSection,
    setActiveSection,
    graphWindow,
    setGraphWindow,
    historyWindow,
    setHistoryWindow,
    revision,
  }
}
