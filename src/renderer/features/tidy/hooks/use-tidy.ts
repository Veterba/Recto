import { useCallback, useState } from 'react'
import { ATTACHMENTS_FOLDER } from '@shared/vault'
import { periodicFolders, type TemplateSettings } from '@shared/templates'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { CARD_FOLDER } from '../../boards'
import { CHAT_FOLDER } from '../../ai'
import { planTidy, type TidyPlan } from '../tidy'

/** Tidy's plan, while its dialog is open, and the two steps: plan, then move. */
export function useTidy(
  allNotes: string[],
  allFolders: string[],
  templates: TemplateSettings,
  refresh: () => Promise<void>,
): {
  tidy: TidyPlan | null
  setTidy: (plan: TidyPlan | null) => void
  tidyBusy: boolean
  openTidy: () => Promise<void>
  runTidy: () => Promise<void>
} {
  const [tidy, setTidy] = useState<TidyPlan | null>(null)
  const [tidyBusy, setTidyBusy] = useState(false)

  /**
   * Build the plan, then show it. Nothing moves until the dialog is confirmed -
   * this rewrites links across the vault, and a reorganisation you did not get
   * to read first is one you cannot trust.
   */
  const openTidy = useCallback(async () => {
    const context = await api.invoke(IPC.indexContext)
    setTidy(
      planTidy({
        notes: allNotes,
        folders: allFolders,
        context: new Map(context.map((entry) => [entry.path, { tags: entry.tags, links: entry.links }])),
        // The board owns one of these and templates are not notes you file;
        // a stray note landing in either would turn up where nobody put it.
        reserved: [CARD_FOLDER, CHAT_FOLDER, ATTACHMENTS_FOLDER, templates.folder, ...periodicFolders(templates.periodic)],
      }),
    )
  }, [allNotes, allFolders, templates])

  const runTidy = useCallback(async () => {
    if (tidy === null) return
    setTidyBusy(true)
    const failed: string[] = []
    try {
      // Create each new folder once, even when several notes are headed for it.
      // A folder that could not be made is not moved into: `fs:move` would
      // find whatever else answers to that name.
      const created = new Set<string>()
      const missing = new Set<string>()
      for (const move of tidy.moves) {
        if (!move.creates || created.has(move.into) || missing.has(move.into)) continue
        const made = await api.invoke(IPC.fsCreate, '', move.into, 'folder')
        if (made.ok && made.path === move.into) created.add(move.into)
        else missing.add(move.into)
      }
      for (const move of tidy.moves) {
        if (missing.has(move.into)) {
          failed.push(move.path)
          continue
        }
        // `fs:move` is the same path as a drag in the tree, so links follow.
        const moved = await api.invoke(IPC.fsMove, move.path, move.into)
        if (!moved.ok) failed.push(move.path)
      }
    } catch {
      failed.push('…')
    } finally {
      await refresh()
      noteIndexChanged()
      setTidyBusy(false)
    }
    // What did not move is said, with the plan left open, rather than the
    // dialog closing as if it all went.
    if (failed.length === 0) setTidy(null)
    else setTidy({ ...tidy, moves: [], skipped: [...failed.map((path) => ({ path, reason: 'could not be moved' })), ...tidy.skipped] })
  }, [tidy, refresh])

  return { tidy, setTidy, tidyBusy, openTidy, runTidy }
}
