import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode } from '@shared/ipc-contract'
import { api } from '../api'
import { applyChanges, indexTree, type VaultTree } from './file-tree-ops'
import { noteIndexChanged } from './note-bus'

/** Subscribes React to the vault and keeps the tree in sync with disk. */

export type VaultApi = {
  tree: VaultTree
  loading: boolean
  refresh: () => Promise<void>
}

export function useVault(enabled: boolean): VaultApi {
  const [roots, setRoots] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    const next = await api.invoke('fs:tree')
    if (mounted.current) {
      setRoots(next)
      setLoading(false)
      // The tree being reloaded means files were created, renamed or deleted,
      // so anything derived from the index (the graph, for one) is now stale.
      noteIndexChanged()
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    return api.on('vault:changed', (changes) => {
      setRoots((prev) => applyChanges(prev, changes))
      noteIndexChanged()
    })
  }, [enabled, refresh])

  const tree = useMemo<VaultTree>(() => ({ roots, byPath: indexTree(roots) }), [roots])

  return { tree, loading, refresh }
}
