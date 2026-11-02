import { useEffect } from 'react'
import type { FileNode } from '@shared/vault'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import type { useBoards } from '../../features/boards'

/** What an empty Canvas or Tasks workspace opens by itself. */
export function useSectionDefaults(
  activeSection: SectionId,
  sections: WorkspaceApi['sections'],
  revision: number,
  roots: readonly FileNode[],
  boards: ReturnType<typeof useBoards>,
): void {
  /** An empty Canvas workspace shows what Canvas will be. */
  useEffect(() => {
    if (activeSection !== 'canvas') return
    const canvas = sections?.canvas
    if (canvas === undefined || canvas.activeLeaf !== null) return
    canvas.openView('canvas')
  }, [activeSection, sections, revision])

  /**
   * An empty Tasks workspace opens its first board.
   *
   * Without this, switching to Tasks the first time shows an empty pane and
   * leaves you to work out that a board lives in the sidebar.
   */
  useEffect(() => {
    if (activeSection !== 'tasks') return
    const tasks = sections?.tasks
    if (tasks === undefined || tasks.activeLeaf !== null) return
    const first = boards[0]
    if (first !== undefined) tasks.openView('board', { path: first.path })
  }, [activeSection, sections, revision, boards])
}
