import { useRef } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import type { LinkCandidate } from '../../features/editor'
import { registerMarkdownView, renderNoteEditor } from '../../features/editor'
import { registerUnresolvedView } from '../../features/links'
import { registerGraphView } from '../../features/graph'
import { BoardNote, registerBoardView, useIsBoard } from '../../features/boards'
import { registerOverviewView } from '../../features/home'
import type { Appearance } from '../appearance'
import type { FileNode } from '@shared/vault'
import type { SectionId } from '../sections'
import { registerNewTabView } from '../components/NewTabView'
import { registerCanvasView } from '../../features/canvas'
import { allFolderPaths } from '../../features/file-tree'

/**
 * Register the views that need callbacks into the shell, once, on the first
 * render. They read the shell's current state through these refs, so nothing
 * is re-registered when it changes.
 */
export function useRegisterViews(refs: {
  openFile: React.RefObject<(path: string, heading?: string | null) => void>
  /** For the overview tab: a folder from "Most written in", and whether a note is there. */
  openFolder: React.RefObject<(name: string) => void>
  noteExists: React.RefObject<(path: string) => boolean>
  openBoardCard: React.RefObject<(path: string) => void>
  openBoard: React.RefObject<(path: string, card?: string) => void>
  linkCandidates: React.RefObject<LinkCandidate[]>
  appearance: React.RefObject<Appearance>
  update: React.RefObject<(patch: Partial<Appearance>) => void>
  /** For the new-tab page: the notes, and making one by name. */
  roots: React.RefObject<readonly FileNode[]>
  section: React.RefObject<SectionId>
  /** "New canvas" on the Canvas page: name one in the sidebar. */
  newCanvas: React.RefObject<() => void>
  createNamed: React.RefObject<(parent: string, name: string) => Promise<string | null>>
  /** A canvas's note opened in the pane beside it. */
  openBeside: React.RefObject<(leafId: string, path: string) => void>
}): void {
  // Registered here rather than at module scope because the markdown view needs
  // a callback into the shell to follow a wikilink.
  const registered = useRef(false)
  if (registered.current) return
  registered.current = true
  registerMarkdownView(
    (target, heading, source) => {
      void api.invoke(IPC.indexResolveLink, target, source).then((resolved) => {
        if (resolved !== null) refs.openFile.current(resolved, heading)
      })
    },
    (p, heading) => refs.openFile.current(p, heading ?? null),
    () => refs.linkCandidates.current,
    () => refs.appearance.current.livePreview,
    () => refs.appearance.current.vimMode,
    () => refs.appearance.current.showNoteTitle,
    // A board note opened as a note is still a board, its Markdown one click away.
    {
      useHosted: useIsBoard,
      render: (p, editor) => <BoardNote path={p} editor={editor} onOpenNote={(card) => refs.openBoardCard.current(card)} />,
    },
  )
  registerUnresolvedView((p) => refs.openFile.current(p))
  registerGraphView(
    (p) => refs.openFile.current(p),
    (card, board) => refs.openBoard.current(board, card),
  )
  registerBoardView((p) => refs.openBoardCard.current(p), renderNoteEditor)
  registerOverviewView({
    openFile: (p) => refs.openFile.current(p),
    openFolder: (name) => refs.openFolder.current(name),
    exists: (p) => refs.noteExists.current(p),
  })
  registerCanvasView({
    openFile: (p) => refs.openFile.current(p),
    openLink: (target, source) => {
      void api.invoke(IPC.indexResolveLink, target, source).then((resolved) => {
        if (resolved !== null) refs.openFile.current(resolved)
      })
    },
    newCanvas: () => refs.newCanvas.current(),
    folders: () => allFolderPaths(refs.roots.current).filter((f) => f !== 'Recto' && !f.startsWith('Recto/')),
    roots: () => refs.roots.current,
    openBeside: (leafId, path) => refs.openBeside.current(leafId, path),
  })
  registerNewTabView({
    section: () => refs.section.current,
    roots: () => refs.roots.current,
    openFile: (p) => refs.openFile.current(p),
    openBoard: (p) => refs.openBoard.current(p),
    createNamed: (parent, name) => refs.createNamed.current(parent, name),
  })
}
