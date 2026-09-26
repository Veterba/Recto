import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { coerceOrder, type TreeOrder } from '../tree-order'

export function useTreeOrder(): { order: TreeOrder; saveOrder: (next: TreeOrder) => void } {
  /**
   * The order folders were arranged in by hand, per vault.
   *
   * The filesystem has none, so without this a dragged folder would spring back
   * to its alphabetical place the moment the tree refreshed.
   */
  const [order, setOrder] = useState<TreeOrder>({})
  useEffect(() => {
    void api.invoke(IPC.stateRead, 'tree-order').then((raw) => setOrder(coerceOrder(raw)))
  }, [])
  const saveOrder = useCallback((next: TreeOrder) => {
    setOrder(next)
    void api.invoke(IPC.stateWrite, 'tree-order', next)
  }, [])
  return { order, saveOrder }
}
