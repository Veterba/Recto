import { useCallback, useEffect, useRef } from 'react'
import type { FileNode } from '@shared/vault'
import { IPC } from '@shared/ipc'
import { fillTemplate, mergeTemplateProperties, PERIODS, templateBody, type Period, type TemplateSettings } from '@shared/templates'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { getActiveEditor } from '../../editor'
import {
  dayKey,
  elsewhereNotice,
  ensurePeriodicNote,
  ensureTodayNote,
  NO_PERIOD_NOTICE,
  retemplatePeriodicNotes,
  showPeriodicNotice,
  type EnsureResult,
  type useTemplateSettings,
} from '../periodic-notes'
import { periodNotePath } from '@shared/periodic'

type Templates = ReturnType<typeof useTemplateSettings>

/** What the shell does with templates: insert one, save the settings, open a periodic note. */
export function useTemplateActions({
  activePath,
  closePicker,
  byPath,
  notes,
  templates,
  refresh,
  openFile,
  openPeriodicSettings,
}: {
  activePath: string | null
  closePicker: () => void
  byPath: ReadonlyMap<string, FileNode>
  /** Every note in the vault, for the unique-name check. */
  notes: readonly string[]
  templates: Templates
  refresh: () => Promise<void>
  /** Read at call time, so it is always the current opener. */
  openFile: React.RefObject<(path: string) => void>
  /** Settings, on the Periodic notes tab. */
  openPeriodicSettings: () => void
}): {
  insertTemplate: (templatePath: string) => Promise<void>
  updateTemplates: (requested: TemplateSettings) => Promise<void>
  openPeriodicNote: (period: Period) => Promise<void>
  openTodayNote: () => Promise<void>
} {
  /**
   * Insert a template at the cursor.
   *
   * Its own frontmatter is dropped first: a template is a note, so it may have
   * picked some up, and a second `---` block halfway down a file is a rule and
   * a pile of stray text rather than metadata.
   */
  const insertTemplate = useCallback(
    async (templatePath: string) => {
      closePicker()
      const editor = getActiveEditor()
      const target = activePath
      if (editor === null || target === null) return

      const read = await api.invoke(IPC.fsRead, templatePath)
      if (!read.ok) return

      const name = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '')
      const text = fillTemplate(templateBody(read.content), {
        title: name,
        path: target,
        now: new Date(),
      })

      editor.run((state) => {
        const range = state.selection.main
        return {
          changes: { from: range.from, to: range.to, insert: text },
          selection: { anchor: range.from + text.length },
          scrollIntoView: true,
          userEvent: 'input.template',
        }
      })

      // The template's own properties join the note's, rather than being
      // dropped with the frontmatter block the insert strips.
      const merged = mergeTemplateProperties(editor.getValue(), read.content)
      if (merged !== editor.getValue()) editor.setValue(merged)
    },
    [activePath],
  )

  /**
   * Save template settings, creating the templates folder if it is new.
   *
   * Created on save rather than on first use: the whole point of choosing a
   * folder is to go and put templates in it, and a folder that only appears
   * after the first template is one you cannot put the first template in.
   * Nothing is moved from the old folder - that would be a vault-wide rename
   * with link rewrites, which is not what "change a setting" should do.
   */
  const updateTemplates = useCallback(
    async (requested: TemplateSettings) => {
      /**
       * Match an existing folder regardless of case.
       *
       * The Mac disk is case-insensitive and the tree is not: typing
       * "Templates" beside an existing "templates" found nothing in the tree,
       * asked main to create it, and main - seeing the name taken on disk -
       * made "Templates 2". Adopting the folder's real spelling instead means
       * the setting points at the folder that is actually there.
       */
      const existing = [...byPath.values()].find(
        (node) => node.kind === 'folder' && node.path.toLowerCase() === requested.folder.toLowerCase(),
      )
      const next = existing === undefined ? requested : { ...requested, folder: existing.path }
      const previous = templates.settings
      templates.update(next)

      if (existing === undefined) {
        const at = next.folder.lastIndexOf('/')
        await api.invoke(IPC.fsCreate, at === -1 ? '' : next.folder.slice(0, at), next.folder.slice(at + 1), 'folder')
        await refresh()
      }
      if (await retemplatePeriodicNotes(previous, next)) noteIndexChanged()
    },
    [templates, byPath, refresh],
  )

  /** Open a note `ensurePeriodicNote` answered with, or the note of that name elsewhere. */
  const openEnsured = useCallback(
    async (period: Period, result: EnsureResult) => {
      if (!result.ok) {
        if ('elsewhere' in result) {
          showPeriodicNotice(elsewhereNotice(periodNotePath(period, new Date(), templates.settings.periodic).key, result.elsewhere))
          openFile.current(result.elsewhere)
        }
        return
      }
      if (result.created) {
        await refresh()
        noteIndexChanged()
      }
      openFile.current(result.path)
    },
    [templates.settings, refresh],
  )

  /**
   * Open the current day's, week's, month's or year's note, making it if
   * needed - also when that period is switched off, since asking for it is
   * asking for it. A note of that name elsewhere is opened instead, with a
   * word about why it is not where the settings would put it.
   */
  const openPeriodicNote = useCallback(
    async (period: Period) => openEnsured(period, await ensurePeriodicNote(period, templates.settings, notes)),
    [templates.settings, notes, openEnsured],
  )

  /**
   * "Today's note": the note of the shortest period that is on. The command,
   * its hotkey and the status bar button all come here. With no period on,
   * nothing is made and the notice offers the settings that would change that.
   */
  const openTodayNote = useCallback(async () => {
    const today = await ensureTodayNote(templates.settings, notes)
    if (today === null) {
      showPeriodicNotice(NO_PERIOD_NOTICE, { label: 'Open settings', run: openPeriodicSettings })
      return
    }
    await openEnsured(today.period, today.result)
  }, [templates.settings, notes, openEnsured, openPeriodicSettings])

  return { insertTemplate, updateTemplates, openPeriodicNote, openTodayNote }
}

/**
 * The periodic notes, made automatically.
 *
 * Checked when the vault opens, when the settings change, when the window
 * comes back into focus, and once a minute - and acted on only when the
 * calendar day has changed since the last check (every period starts on a
 * day boundary). So a laptop opened the next morning gets its notes within a
 * minute without anyone doing anything, and an app left running overnight
 * rolls over at midnight. Only the current period's note, never earlier ones:
 * a month Recto was not open in gets no note afterwards.
 *
 * Not while Settings is open: switching Weekly on and then Monthly a second
 * later would make this week's note where Weekly alone puts it, and then the
 * month folder it belongs in would find the name taken. The notes are made
 * when Settings closes, where its preview said.
 *
 * It creates the notes; it does not open them. Taking over the editor on
 * launch would be the app deciding what you do first - "Open today" is one
 * command away for when you want it.
 */
export function usePeriodicNotesAutoCreate(
  templates: Templates,
  notes: readonly string[],
  refresh: () => Promise<void>,
  paused: boolean,
): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const notesRef = useRef(notes)
  notesRef.current = notes
  const on = templates.loaded && !paused && PERIODS.some((p) => templates.settings.periodic[p].enabled)
  useEffect(() => {
    if (!on) return
    let lastDay = ''
    let running = false
    const check = async (): Promise<void> => {
      const today = dayKey()
      if (today === lastDay || running) return
      running = true
      try {
        const results: [Period, EnsureResult][] = []
        for (const period of PERIODS) {
          if (!templates.settings.periodic[period].enabled) continue
          results.push([period, await ensurePeriodicNote(period, templates.settings, notesRef.current)])
        }
        // A name taken elsewhere is said once and not retried until tomorrow;
        // an error is tried again at the next check.
        for (const [period, result] of results)
          if (!result.ok && 'elsewhere' in result)
            showPeriodicNotice(elsewhereNotice(periodNotePath(period, new Date(), templates.settings.periodic).key, result.elsewhere))
        if (results.every(([, r]) => r.ok || 'elsewhere' in r)) lastDay = today
        if (results.some(([, r]) => r.ok && r.created)) {
          await refreshRef.current()
          noteIndexChanged()
        }
      } finally {
        running = false
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [on, templates.settings])
}
