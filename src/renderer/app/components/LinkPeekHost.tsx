import { useEffect, useSyncExternalStore } from 'react'
import { NotePreviewCard } from '../../features/file-tree'
import { closeLinkPeek, holdLinkPeek, installLinkPeekWatch, linkPeekSnapshot, releaseLinkPeek, setLinkPeekDelay, subscribeLinkPeek } from '../link-peek'

/** The note preview card - for a link or a tree row (see link-peek.ts) - put away by anything you do. */
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

  // A press, a key, a scroll, the window losing focus: you have moved on.
  useEffect(() => installLinkPeekWatch(), [])

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
