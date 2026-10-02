import { useRef } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import type { LinkCandidate } from '../../features/editor'
import { registerMarkdownView } from '../../features/editor'
import { registerUnresolvedView } from '../../features/links'
import { registerGraphView } from '../../features/graph'
import { registerBoardView } from '../../features/boards'
import { registerChatView } from '../../features/ai'
import { registerBotView } from '../../features/bots'
import type { Appearance } from '../appearance'

/**
 * Register the views that need callbacks into the shell, once, on the first
 * render. They read the shell's current state through these refs, so nothing
 * is re-registered when it changes.
 */
export function useRegisterViews(refs: {
  openFile: React.RefObject<(path: string, heading?: string | null) => void>
  openBoardCard: React.RefObject<(path: string) => void>
  linkCandidates: React.RefObject<LinkCandidate[]>
  appearance: React.RefObject<Appearance>
  update: React.RefObject<(patch: Partial<Appearance>) => void>
}): void {
  // Registered here rather than at module scope because the markdown view needs
  // a callback into the shell to follow a wikilink.
  const registered = useRef(false)
  if (registered.current) return
  registered.current = true
  registerMarkdownView(
    (target, heading) => {
      void api.invoke(IPC.indexResolveLink, target).then((resolved) => {
        if (resolved !== null) refs.openFile.current(resolved, heading)
      })
    },
    (p, heading) => refs.openFile.current(p, heading ?? null),
    () => refs.linkCandidates.current,
    () => refs.appearance.current.livePreview,
    () => refs.appearance.current.vimMode,
    () => refs.appearance.current.showNoteTitle,
  )
  registerUnresolvedView((p) => refs.openFile.current(p))
  registerGraphView((p) => refs.openFile.current(p))
  registerBoardView((p) => refs.openBoardCard.current(p))
  registerChatView(
    () => refs.appearance.current.aiModel,
    (aiModel) => refs.update.current({ aiModel }),
  )
  registerBotView((p, heading) => refs.openFile.current(p, heading ?? null))
}
