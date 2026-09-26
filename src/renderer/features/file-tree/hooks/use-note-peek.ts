import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileNode } from '@shared/vault'

/**
 * Once one preview is open, the next row's opens quickly - you are browsing
 * previews now, and waiting two seconds per row would make that unbearable.
 * The same rule macOS uses for tooltips.
 */
const PREVIEW_WARM_MS = 250
/** Grace for the trip from the row to the card, so crossing the gap does not close it. */
const PREVIEW_CLOSE_MS = 180

type Peek = { node: FileNode; anchor: { top: number; right: number; bottom: number } }

/** The note preview card: opened after a hover delay, warm while moving between rows, put away by anything else. */
export function useNotePeek(previewDelayMs: number): {
  peek: Peek | null
  peekTimer: React.RefObject<number | undefined>
  cancelPeek: () => void
  hoverRow: (node: FileNode, element: HTMLElement) => void
  leaveRow: () => void
} {
  /** The open preview card, and the row it is anchored to. */
  const [peek, setPeek] = useState<Peek | null>(null)
  const peekTimer = useRef<number | undefined>(undefined)
  const peekOpen = useRef(false)
  peekOpen.current = peek !== null

  const cancelPeek = useCallback(() => {
    window.clearTimeout(peekTimer.current)
    setPeek(null)
  }, [])

  const delayRef = useRef(previewDelayMs)
  delayRef.current = previewDelayMs
  const hoverRow = useCallback((node: FileNode, element: HTMLElement) => {
    window.clearTimeout(peekTimer.current)
    // Notes only: a folder has no gist, and an image previews itself.
    if (node.kind !== 'file' || !node.name.toLowerCase().endsWith('.md')) {
      if (peekOpen.current) peekTimer.current = window.setTimeout(() => setPeek(null), PREVIEW_CLOSE_MS)
      return
    }
    const box = element.getBoundingClientRect()
    peekTimer.current = window.setTimeout(
      () => setPeek({ node, anchor: { top: box.top, right: box.right, bottom: box.bottom } }),
      peekOpen.current ? PREVIEW_WARM_MS : delayRef.current,
    )
  }, [])

  const leaveRow = useCallback(() => {
    window.clearTimeout(peekTimer.current)
    if (peekOpen.current) peekTimer.current = window.setTimeout(() => setPeek(null), PREVIEW_CLOSE_MS)
  }, [])

  // Anything that means "I am doing something now" puts the preview away:
  // a click, a key, the window losing focus. Scroll is handled on the tree.
  useEffect(() => {
    if (peek === null) return
    const close = (): void => cancelPeek()
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [peek, cancelPeek])

  useEffect(() => () => window.clearTimeout(peekTimer.current), [])

  return { peek, peekTimer, cancelPeek, hoverRow, leaveRow }
}
