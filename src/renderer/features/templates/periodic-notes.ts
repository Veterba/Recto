import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../../app/api'
import { setField } from '@shared/frontmatter'
import { nameTakenElsewhere, parentLink, periodNotePath, todayPeriod } from '@shared/periodic'
import {
  BUILT_IN_DAILY,
  coerceTemplateSettings,
  DEFAULT_TEMPLATE_SETTINGS,
  fillTemplate,
  PERIODS,
  templateBody,
  type Period,
  type TemplateSettings,
} from '@shared/templates'
import { IPC } from '@shared/ipc'

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
    void api.invoke(IPC.stateRead, 'templates').then((raw) => {
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
    void api.invoke(IPC.stateWrite, 'templates', next)
  }, [])

  return { settings, loaded, update }
}

export type EnsureResult =
  | { ok: true; path: string; created: boolean }
  /** A note with the same name is somewhere else in the vault: nothing was made. */
  | { ok: false; elsewhere: string }
  | { ok: false; error: string }

/**
 * Make sure the note for this period exists. Returns its path, and whether it
 * was created just now.
 *
 * Never overwrites. A note that already exists is one the user may have
 * written in, and "the app replaced my morning's notes with the empty template"
 * is the one outcome this feature cannot be allowed to have. The existence
 * check is a read rather than a look at the file tree, because the tree can be
 * a beat behind a note created a moment ago.
 *
 * Names are unique in a vault, so a note called "2026-W41" anywhere else - an
 * old one left behind when the folder setting changed, say - means this one is
 * not made: two notes of one name would make every link to it ambiguous.
 */
export async function ensurePeriodicNote(
  period: Period,
  settings: TemplateSettings,
  notes: readonly string[],
  now: Date = new Date(),
): Promise<EnsureResult> {
  const target = periodNotePath(period, now, settings.periodic)

  const existing = await api.invoke(IPC.fsRead, target.path)
  if (existing.ok) return { ok: true, path: target.path, created: false }

  const elsewhere = nameTakenElsewhere(target.path, notes)
  if (elsewhere !== null) return { ok: false, elsewhere }

  // A chosen template that has since been deleted falls back to the built-in
  // one rather than skipping the period: a missing template is a settings
  // problem, a missing daily note is a lost day.
  const text = await generatedText(period, settings, now)

  // `fs:create` makes every missing folder on the way down, so the year, the
  // month and the week folders all appear from this one call.
  // `fs:create` refuses a name taken anywhere in the vault, so it never
  // overwrites. If something else made this very note between the read and
  // the create, that note is the one to open; `notes` may also be a beat
  // behind a note of this name elsewhere, and then main's refusal names it.
  const created = await api.invoke(IPC.fsCreate, target.folder, target.name, 'file')
  if (!created.ok) {
    const raced = await api.invoke(IPC.fsRead, target.path)
    if (raced.ok) return { ok: true, path: target.path, created: false }
    return { ok: false, error: created.error }
  }

  await api.invoke(IPC.fsWrite, created.path, text)
  return { ok: true, path: created.path, created: true }
}

/**
 * Make sure "Today's note" exists: the note of the shortest period that is on
 * (see `todayPeriod`). Null when no period is on, and then nothing is made -
 * no note, no folder.
 */
export async function ensureTodayNote(
  settings: TemplateSettings,
  notes: readonly string[],
  now: Date = new Date(),
): Promise<{ period: Period; result: EnsureResult } | null> {
  const period = todayPeriod(settings.periodic)
  if (period === null) return null
  return { period, result: await ensurePeriodicNote(period, settings, notes, now) }
}

/** What to say when "Today's note" has no period to open. */
export const NO_PERIOD_NOTICE = "No periodic notes are on, so there is no today's note to open."

/** The calendar day, as a key that changes exactly at local midnight - when any period can change. */
export const dayKey = (date: Date = new Date()): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** What a periodic note made from these settings would contain, before anyone edits it. */
async function generatedText(period: Period, settings: TemplateSettings, now: Date): Promise<string> {
  const target = periodNotePath(period, now, settings.periodic)
  const chosen = settings.periodic[period].template
  let body = period === 'daily' ? BUILT_IN_DAILY : '# {{title}}\n\n'
  if (chosen !== null) {
    const template = await api.invoke(IPC.fsRead, chosen)
    // An EMPTY template counts as no template. That is not hypothetical: a
    // template file created and never written in produced a blank, 0-byte
    // daily note with nothing to say why - which looks exactly like the
    // feature being broken. The built-in heading at least says what day it is;
    // Settings flags the empty template so it gets filled in.
    // The WHOLE template, frontmatter included: a daily template's properties
    // are the point of writing them there, and stripping them left every daily
    // note with none. (A template inserted into an existing note is the other
    // case - see `mergeTemplateProperties`.)
    if (template.ok && templateBody(template.content).trim() !== '') body = template.content
  }
  const text = fillTemplate(body, { title: target.key, path: target.path, now, weekStart: settings.periodic.weekStart })
  const link = parentLink(period, now, settings.periodic)
  return link === null ? text : setField(text, link.key, link.value)
}

/**
 * Re-make a current periodic note from a newly chosen template - but only if
 * nobody has touched it.
 *
 * This closes a trap in the obvious order of doing things: switch a period
 * on, THEN pick a template. Switching it on creates the current note at once
 * from the built-in template, so the template chosen a second later would
 * otherwise only apply from the next period, and this one looks like the
 * setting did nothing.
 *
 * "Untouched" is exact: the file must still be byte-for-byte what the previous
 * settings would have generated. One typed character and it is the user's note,
 * and it is left alone.
 */
export async function retemplatePeriodicNotes(
  previous: TemplateSettings,
  next: TemplateSettings,
  now: Date = new Date(),
): Promise<boolean> {
  let changed = false
  for (const period of PERIODS) {
    if (!next.periodic[period].enabled || previous.periodic[period].template === next.periodic[period].template) continue
    const target = periodNotePath(period, now, next.periodic)
    if (periodNotePath(period, now, previous.periodic).path !== target.path) continue
    const current = await api.invoke(IPC.fsRead, target.path)
    if (!current.ok) continue
    if (current.content !== (await generatedText(period, previous, now))) continue
    await api.invoke(IPC.fsWrite, target.path, await generatedText(period, next, now))
    changed = true
  }
  return changed
}

/**
 * "2026-W41 wasn't created: a note with that name is at Old/2026-W41.md", in
 * the status bar until dismissed. A module store, because the shell's status
 * bar shows it and the periodic-note code that has something to say is not a
 * component.
 */
export type PeriodicNoticeState = { text: string; action?: { label: string; run: () => void } }
let notice: PeriodicNoticeState | null = null
const listeners = new Set<() => void>()
export function showPeriodicNotice(text: string | null, action?: PeriodicNoticeState['action']): void {
  notice = text === null ? null : action === undefined ? { text } : { text, action }
  for (const listener of listeners) listener()
}
export function usePeriodicNotice(): PeriodicNoticeState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => notice,
  )
}

/** What to say when a note was not made because its name is taken. */
export const elsewhereNotice = (key: string, elsewhere: string): string =>
  `${key} wasn't created: a note with that name is already at ${elsewhere}. Note names are unique in a vault.`
