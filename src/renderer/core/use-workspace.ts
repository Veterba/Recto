import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { DEFAULT_SECTION, isSectionId, SECTIONS, type SectionId } from './sections'
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
  /** Right-hand graph dock, shared across sections. */
  graphDock?: { open: boolean; width: number }
}

export const GRAPH_DOCK_DEFAULT = { open: false, width: 340 }

function parse(saved: unknown): { layouts: Partial<Record<SectionId, WorkspaceLayout>>; active: SectionId; graphDock: { open: boolean; width: number } } {
  const fallback = { layouts: {}, active: DEFAULT_SECTION, graphDock: GRAPH_DOCK_DEFAULT }
  if (typeof saved !== 'object' || saved === null) return fallback

  const file = saved as Partial<SavedFile>
  // A v1 file held a single layout. Rather than migrate it into a guessed
  // section, drop it: it is a tab list, not user content, and it rebuilds in
  // one click. Silently mis-homing someone's tabs is worse than a clean start.
  if (file.version !== 2) return fallback

  return {
    layouts: file.sections ?? {},
    active: isSectionId(file.activeSection) ? file.activeSection : DEFAULT_SECTION,
    graphDock: {
      open: file.graphDock?.open ?? GRAPH_DOCK_DEFAULT.open,
      width: Math.min(720, Math.max(240, file.graphDock?.width ?? GRAPH_DOCK_DEFAULT.width)),
    },
  }
}

export type WorkspaceApi = {
  sections: Sections | null
  active: Workspace | null
  activeSection: SectionId
  setActiveSection: (id: SectionId) => void
  graphDock: { open: boolean; width: number }
  setGraphDock: (next: Partial<{ open: boolean; width: number }>) => void
  revision: number
}

export function useWorkspace(): WorkspaceApi {
  const [sections, setSections] = useState<Sections | null>(null)
  const [activeSection, setActive] = useState<SectionId>(DEFAULT_SECTION)
  const [graphDock, setDock] = useState(GRAPH_DOCK_DEFAULT)
  const [revision, setRevision] = useState(0)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void api.invoke('state:read', 'workspace').then((saved) => {
      if (cancelled) return
      const { layouts, active, graphDock: dock } = parse(saved)
      const built = Object.fromEntries(
        SECTIONS.map((section) => [section.id, new Workspace(layouts[section.id])]),
      ) as Sections
      setSections(built)
      setActive(active)
      setDock(dock)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const serialize = useCallback(
    (current: Sections, active: SectionId, dock: typeof GRAPH_DOCK_DEFAULT): SavedFile => ({
      version: 2,
      sections: Object.fromEntries(
        SECTIONS.map((section) => [section.id, current[section.id].serialize()]),
      ) as SavedFile['sections'],
      activeSection: active,
      graphDock: dock,
    }),
    [],
  )

  const save = useCallback(
    (current: Sections, active: SectionId, dock: typeof GRAPH_DOCK_DEFAULT) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void api.invoke('state:write', 'workspace', serialize(current, active, dock))
      }, 400)
    },
    [serialize],
  )

  // One subscription per section: any of them changing bumps the same revision,
  // because the whole file is written as a unit anyway.
  useEffect(() => {
    if (!sections) return
    const refs = SECTIONS.map((section) =>
      sections[section.id].on('layout-change', () => {
        setRevision((n) => n + 1)
        save(sections, activeSection, graphDock)
      }),
    )
    return () => {
      refs.forEach((ref) => ref.detach())
      window.clearTimeout(saveTimer.current)
      // Flush on teardown so quitting never loses the last change.
      void api.invoke('state:write', 'workspace', serialize(sections, activeSection, graphDock))
    }
  }, [sections, activeSection, graphDock, save, serialize])

  const setActiveSection = useCallback(
    (id: SectionId) => {
      setActive(id)
      setRevision((n) => n + 1)
      if (sections) save(sections, id, graphDock)
    },
    [sections, graphDock, save],
  )

  const setGraphDock = useCallback(
    (patch: Partial<{ open: boolean; width: number }>) => {
      setDock((prev) => {
        const next = { ...prev, ...patch }
        if (sections) save(sections, activeSection, next)
        return next
      })
    },
    [sections, activeSection, save],
  )

  const active = useMemo(() => (sections ? sections[activeSection] : null), [sections, activeSection])

  return { sections, active, activeSection, setActiveSection, graphDock, setGraphDock, revision }
}
