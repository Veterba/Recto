import { useEffect, useRef, useState } from 'react'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { DEFAULT_TUNABLES, type Tunables } from '../protocol'
import { DEFAULT_LOOK, type GraphLook } from '../look'
import { ALL_LINKS, type LinkRange } from '../degree-bins'
import { DEFAULT_LAYOUT, type GraphLayout } from '../layout'
import { parseSettings } from '../settings'

/** A slider drag is dozens of changes and one intended setting. */
const SETTINGS_DEBOUNCE_MS = 400

/** The graph's persisted settings, read from `.recto/graph.json` and written back as they change. */
export function useGraphSettings(): {
  tunables: Tunables
  setTunables: (tunables: Tunables) => void
  showLabels: boolean
  setShowLabels: (on: boolean) => void
  showOrphans: boolean
  setShowOrphans: (on: boolean) => void
  showTasks: boolean
  setShowTasks: (on: boolean) => void
  showChats: boolean
  setShowChats: (on: boolean) => void
  look: GraphLook
  setLook: (look: GraphLook) => void
  layout: GraphLayout
  setLayout: (layout: GraphLayout) => void
  linkRange: LinkRange
  setLinkRange: (range: LinkRange) => void
  localOnly: boolean
  setLocalOnly: (on: boolean) => void
} {
  const [tunables, setTunables] = useState<Tunables>(DEFAULT_TUNABLES)
  const [showLabels, setShowLabels] = useState(true)
  const [showOrphans, setShowOrphans] = useState(true)
  const [showTasks, setShowTasks] = useState(false)
  const [showChats, setShowChats] = useState(true)
  const [look, setLook] = useState<GraphLook>(DEFAULT_LOOK)
  const [layout, setLayout] = useState<GraphLayout>(DEFAULT_LAYOUT)
  const [linkRange, setLinkRange] = useState<LinkRange>(ALL_LINKS)
  const [localOnly, setLocalOnly] = useState(false)

  /** Nothing is written back until the saved file has been read, or the first
      render would overwrite it with defaults. */
  const loadedSettings = useRef(false)

  useEffect(() => {
    void api.invoke(IPC.stateRead, 'graph').then((raw) => {
      const saved = parseSettings(raw)
      setTunables(saved.tunables)
      setShowLabels(saved.showLabels)
      setShowOrphans(saved.showOrphans)
      setShowTasks(saved.showTasks)
      setShowChats(saved.showChats)
      setLook(saved.look)
      setLayout(saved.layout)
      setLinkRange(saved.linkRange)
      setLocalOnly(saved.localOnly)
      loadedSettings.current = true
    })
  }, [])

  useEffect(() => {
    if (!loadedSettings.current) return
    const timer = window.setTimeout(() => {
      void api.invoke(IPC.stateWrite, 'graph', {
        tunables,
        showLabels,
        showOrphans,
        showTasks,
        showChats,
        look,
        layout,
        linkRange,
        localOnly,
      })
    }, SETTINGS_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [tunables, showLabels, showOrphans, showTasks, showChats, look, layout, linkRange, localOnly])

  return {
    tunables,
    setTunables,
    showLabels,
    setShowLabels,
    showOrphans,
    setShowOrphans,
    showTasks,
    setShowTasks,
    showChats,
    setShowChats,
    look,
    setLook,
    layout,
    setLayout,
    linkRange,
    setLinkRange,
    localOnly,
    setLocalOnly,
  }
}
