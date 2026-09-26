import { useCallback, useState } from 'react'
import { ATTACHMENTS_FOLDER } from '@shared/vault'
import type { TemplateSettings } from '@shared/templates'
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
        reserved: [CARD_FOLDER, CHAT_FOLDER, ATTACHMENTS_FOLDER, templates.folder, templates.daily.folder],
      }),
    )
  }, [allNotes, allFolders, templates])

  const runTidy = useCallback(async () => {
    if (tidy === null) return
    setTidyBusy(true)
    // Create each new folder once, even when several notes are headed for it.
    const created = new Set<string>()
    for (const move of tidy.moves) {
      if (!move.creates || created.has(move.into)) continue
      created.add(move.into)
      await api.invoke(IPC.fsCreate, '', move.into, 'folder')
    }
    for (const move of tidy.moves) {
      // `fs:move` is the same path as a drag in the tree, so links follow.
      await api.invoke(IPC.fsMove, move.path, move.into)
    }
    await refresh()
    noteIndexChanged()
    setTidyBusy(false)
    setTidy(null)
  }, [tidy, refresh])

  return { tidy, setTidy, tidyBusy, openTidy, runTidy }
}
