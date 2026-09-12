import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Workspace, type WorkspaceLayout } from './workspace'

/**
 * Subscribes React to the workspace and persists it to workspace.json.
 *
 * The Workspace itself is mutable and framework-free (the editor and graph will
 * read it without React). This hook is the only bridge: bump a counter on
 * `layout-change` to re-render, and debounce the write to disk.
 */
export function useWorkspace(): { workspace: Workspace | null; revision: number } {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [revision, setRevision] = useState(0)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    void api.invoke('state:read', 'workspace').then((saved) => {
      if (cancelled) return
      const layout = isLayout(saved) ? saved : undefined
      // Deliberately no default tab. The rail falls back to Data when nothing
      // is open, so a first boot shows the file tree and an empty pane rather
      // than a dead "Editor" tab with no file in it.
      setWorkspace(new Workspace(layout))
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspace) return

    const ref = workspace.on('layout-change', () => {
      setRevision((n) => n + 1)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void api.invoke('state:write', 'workspace', workspace.serialize())
      }, 400)
    })

    return () => {
      ref.detach()
      window.clearTimeout(saveTimer.current)
      // Flush on unmount so quitting never loses the last change.
      void api.invoke('state:write', 'workspace', workspace.serialize())
    }
  }, [workspace])

  return { workspace, revision }
}

/** Shape-check a file a human may have edited by hand. */
function isLayout(value: unknown): value is WorkspaceLayout {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<WorkspaceLayout>
  if (v.version !== 1) return false
  const root = v.root as { kind?: unknown } | undefined
  return root?.kind === 'tabs' || root?.kind === 'split'
}
