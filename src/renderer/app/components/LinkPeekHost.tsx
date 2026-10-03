import { useEffect, useSyncExternalStore } from 'react'
import { NotePreviewCard } from '../../features/file-tree'
import { closeLinkPeek, holdLinkPeek, linkPeekSnapshot, releaseLinkPeek, setLinkPeekDelay, subscribeLinkPeek } from '../link-peek'

/** The card for the link under the pointer (see link-peek.ts), put away by anything you do. */
export function LinkPeekHost({
  delayMs,
  mtimeOf,
  onOpen,
  onPin,
}: {
  delayMs: number
  /** When the note was last written, for the card's "edited" line. */
  mtimeOf: (path: string) => number | undefined
  onOpen: (path: string) => void
  onPin: (path: string, rect: DOMRect) => void
}): React.ReactElement | null {
  const peek = useSyncExternalStore(subscribeLinkPeek, linkPeekSnapshot)

  useEffect(() => setLinkPeekDelay(delayMs), [delayMs])

  // A key or the window losing focus means you have moved on - as the tree's card does.
  useEffect(() => {
    if (peek === null) return
    window.addEventListener('keydown', closeLinkPeek)
    window.addEventListener('blur', closeLinkPeek)
    return () => {
      window.removeEventListener('keydown', closeLinkPeek)
      window.removeEventListener('blur', closeLinkPeek)
    }
  }, [peek])

  if (peek === null) return null
  return (
    <NotePreviewCard
      key={peek.path}
      path={peek.path}
      anchor={peek.anchor}
      mtime={mtimeOf(peek.path)}
      onOpen={(path) => {
        closeLinkPeek()
        onOpen(path)
      }}
      onPin={(path, rect) => {
        closeLinkPeek()
        onPin(path, rect)
      }}
      onPointerEnter={holdLinkPeek}
      onPointerLeave={releaseLinkPeek}
    />
  )
}
