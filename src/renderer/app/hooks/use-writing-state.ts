import { useEffect } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import { loadWriting, useWriting } from '../../features/editor'

/**
 * The vault's writing tools (focus, syntax, style, authors): read from
 * `.recto/writing.json` when the vault opens and written back as they change -
 * and focus mode reflected on the root element.
 */
export function useWritingState(vaultPath: string): void {
  // Writing tools (focus, syntax, style, authors) belong to the vault, like appearance.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    void api.invoke(IPC.stateRead, 'writing').then((raw) => {
      if (cancelled) return
      loadWriting(raw, (next) => {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void api.invoke(IPC.stateWrite, 'writing', next), 300)
      })
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [vaultPath])

  /**
   * Focus mode hides everything but the text: sidebar, tabs, title and status
   * bars, floating windows, the note's own toolbars. One attribute on the root,
   * and the stylesheet animates each piece away - React keeps them mounted, so
   * leaving focus mode brings back the same scroll positions and open folders.
   */
  const focusMode = useWriting().focus
  useEffect(() => {
    const root = document.documentElement
    if (focusMode) root.setAttribute('data-focus', 'on')
    else root.removeAttribute('data-focus')
    return () => root.removeAttribute('data-focus')
  }, [focusMode])
}
