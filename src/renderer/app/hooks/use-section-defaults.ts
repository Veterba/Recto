import { useEffect } from 'react'
import type { FileNode } from '@shared/vault'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { CHAT_FOLDER } from '../../features/ai'
import type { useBoards } from '../../features/boards'

/** What an empty AI or Tasks workspace opens by itself. */
export function useSectionDefaults(
  activeSection: SectionId,
  sections: WorkspaceApi['sections'],
  revision: number,
  roots: readonly FileNode[],
  boards: ReturnType<typeof useBoards>,
): void {
  /**
   * An empty AI workspace opens the most recent conversation.
   *
   * Same reasoning as Tasks below: arriving at a blank pane and having to work
   * out that the thing you want is in the sidebar is a worse first second than
   * landing in the conversation you had last.
   */
  useEffect(() => {
    if (activeSection !== 'ai') return
    const ai = sections?.ai
    if (ai === undefined || ai.activeLeaf !== null) return
    const folder = roots.find((node) => node.kind === 'folder' && node.path === CHAT_FOLDER)
    const newest = (folder?.children ?? [])
      .filter((node) => node.kind === 'file' && node.name.toLowerCase().endsWith('.md'))
      .map((node) => node.path)
      .sort((a, b) => b.localeCompare(a))[0]
    if (newest !== undefined) ai.openView('chat', { path: newest })
  }, [activeSection, sections, revision, roots])

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
    const first = boards.boards[0]
    if (first !== undefined) tasks.openView('board', { board: first.id })
  }, [activeSection, sections, revision, boards])
}
