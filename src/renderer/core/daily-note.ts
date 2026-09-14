import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import {
  BUILT_IN_DAILY,
  coerceTemplateSettings,
  dailyNotePath,
  DEFAULT_TEMPLATE_SETTINGS,
  fillTemplate,
  templateBody,
  type TemplateSettings,
} from './templates'

/**
 * Template settings for the open vault, from `.recto/templates.json`.
 *
 * Plain component state keyed on the vault, not a module store: only the shell
 * reads it, and a module store would carry one vault's settings into the next
 * vault opened in the same session.
 */
export function useTemplateSettings(vaultPath: string): {
  settings: TemplateSettings
  loaded: boolean
  update: (next: TemplateSettings) => void
} {
  const [settings, setSettings] = useState<TemplateSettings>(DEFAULT_TEMPLATE_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void api.invoke('state:read', 'templates').then((raw) => {
      if (cancelled) return
      setSettings(coerceTemplateSettings(raw))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  const update = useCallback((next: TemplateSettings) => {
    setSettings(next)
    void api.invoke('state:write', 'templates', next)
  }, [])

  return { settings, loaded, update }
}

/**
 * Make sure today's daily note exists. Returns its path, and whether it was
 * created just now.
 *
 * Never overwrites. A daily note that already exists is one the user may have
 * written in, and "the app replaced my morning's notes with the empty template"
 * is the one outcome this feature cannot be allowed to have. The existence
 * check is a read rather than a look at the file tree, because the tree can be
 * a beat behind a note created a moment ago.
 */
export async function ensureDailyNote(
  settings: TemplateSettings,
  now: Date = new Date(),
): Promise<{ ok: true; path: string; created: boolean } | { ok: false; error: string }> {
  const target = dailyNotePath(now, settings.daily.folder)

  const existing = await api.invoke('fs:read', target.path)
  if (existing.ok) return { ok: true, path: target.path, created: false }

  // A chosen template that has since been deleted falls back to the built-in
  // one rather than skipping the day: a missing template is a settings problem,
  // a missing daily note is a lost day.
  const text = await generatedText(settings, now)

  // `fs:create` makes every missing folder on the way down, so Daily/, the
  // year, the month and the week all appear from this one call.
  const created = await api.invoke('fs:create', target.folder, target.name, 'file')
  if (!created.ok) return { ok: false, error: created.error }

  // If something else created the same file between the read and the create,
  // `fs:create` picks a free name ("2026-09-14 2.md") rather than overwriting.
  // A visible duplicate is the right failure: it can be deleted, and a
  // clobbered note cannot be brought back.
  await api.invoke('fs:write', created.path, text)
  return { ok: true, path: created.path, created: true }
}

/** The calendar day, as a key that changes exactly at local midnight. */
export const dayKey = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** What a daily note made from these settings would contain, before anyone edits it. */
async function generatedText(settings: TemplateSettings, now: Date): Promise<string> {
  const target = dailyNotePath(now, settings.daily.folder)
  let body = BUILT_IN_DAILY
  if (settings.daily.template !== null) {
    const template = await api.invoke('fs:read', settings.daily.template)
    if (template.ok) body = templateBody(template.content)
  }
  return fillTemplate(body, { title: target.key, path: target.path, now })
}

/**
 * Re-make today's note from a newly chosen template - but only if nobody has
 * touched it.
 *
 * This closes a trap in the obvious order of doing things: switch the daily
 * note on, THEN pick a template. Switching it on creates today's note at once
 * from the built-in template, so the template chosen a second later would
 * otherwise only apply from tomorrow, and today looks like the setting did
 * nothing.
 *
 * "Untouched" is exact: the file must still be byte-for-byte what the previous
 * settings would have generated. One typed character and it is the user's note,
 * and it is left alone.
 */
export async function retemplateDailyNote(
  previous: TemplateSettings,
  next: TemplateSettings,
  now: Date = new Date(),
): Promise<boolean> {
  if (!next.daily.enabled || previous.daily.template === next.daily.template) return false
  if (previous.daily.folder !== next.daily.folder) return false
  const target = dailyNotePath(now, next.daily.folder)
  const current = await api.invoke('fs:read', target.path)
  if (!current.ok) return false
  if (current.content !== (await generatedText(previous, now))) return false
  await api.invoke('fs:write', target.path, await generatedText(next, now))
  return true
}
