import { useEffect } from 'react'
import type { FileNode } from '@shared/vault'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { MAIN_BOT } from '../../features/bots'
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
   * The AI workspace always has Recto, the main chat. Opened when the section
   * holds no conversation at all - empty, or only tabs from before it was
   * Recto's (a saved layout can still carry a long-gone Settings tab).
   * Landing on a blank or unknown pane and having to find the conversation in
   * the sidebar is a worse first second than landing in it.
   */
  useEffect(() => {
    if (activeSection !== 'ai') return
    const ai = sections?.ai
    if (ai === undefined || ai.leaves().some((leaf) => leaf.type === 'bot' || leaf.type === 'chat')) return
    ai.openView('bot', { bot: MAIN_BOT })
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
    const first = boards.boards[0]
    if (first !== undefined) tasks.openView('board', { board: first.id })
  }, [activeSection, sections, revision, boards])
}
