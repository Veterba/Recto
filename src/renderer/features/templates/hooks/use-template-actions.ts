import { useCallback, useEffect, useRef } from 'react'
import type { FileNode } from '@shared/vault'
import { IPC } from '@shared/ipc'
import { fillTemplate, mergeTemplateProperties, templateBody, type TemplateSettings } from '@shared/templates'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { getActiveEditor } from '../../editor'
import { dayKey, ensureDailyNote, retemplateDailyNote, type useTemplateSettings } from '../daily-note'

type Templates = ReturnType<typeof useTemplateSettings>

/** What the shell does with templates: insert one, save the settings, open today's note. */
export function useTemplateActions({
  activePath,
  closePicker,
  byPath,
  templates,
  refresh,
  openFile,
}: {
  activePath: string | null
  closePicker: () => void
  byPath: ReadonlyMap<string, FileNode>
  templates: Templates
  refresh: () => Promise<void>
  /** Read at call time, so it is always the current opener. */
  openFile: React.RefObject<(path: string) => void>
}): {
  insertTemplate: (templatePath: string) => Promise<void>
  updateTemplates: (requested: TemplateSettings) => Promise<void>
  openDailyNote: () => Promise<void>
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
      if (await retemplateDailyNote(previous, next)) noteIndexChanged()
    },
    [templates, byPath, refresh],
  )

  const openDailyNote = useCallback(async () => {
    const result = await ensureDailyNote(templates.settings)
    if (!result.ok) return
    if (result.created) {
      await refresh()
      noteIndexChanged()
    }
    openFile.current(result.path)
  }, [templates.settings, refresh])

  return { insertTemplate, updateTemplates, openDailyNote }
}

/**
 * The daily note, made automatically.
 *
 * Checked when the vault opens, when the setting changes, when the window
 * comes back into focus, and once a minute - and acted on only when the
 * calendar day has changed since the last check. So a laptop opened the next
 * morning gets its note within a minute without anyone doing anything, and
 * an app left running overnight rolls over at midnight.
 *
 * It creates the note; it does not open it. Taking over the editor on launch
 * would be the app deciding what you do first - "Open today's note" is one
 * command away for when you want it.
 */
export function useDailyNoteAutoCreate(templates: Templates, refresh: () => Promise<void>): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!templates.loaded || !templates.settings.daily.enabled) return
    let lastDay = ''
    let running = false
    const check = async (): Promise<void> => {
      const today = dayKey()
      if (today === lastDay || running) return
      running = true
      try {
        const result = await ensureDailyNote(templates.settings)
        if (result.ok) {
          lastDay = today
          if (result.created) {
            await refreshRef.current()
            noteIndexChanged()
          }
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
  }, [templates.loaded, templates.settings])
}
