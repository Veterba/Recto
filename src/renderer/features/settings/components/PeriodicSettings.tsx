import { useEffect, useState } from 'react'
import { pathTree, periodNotePath } from '@shared/periodic'
import { isInFolder, PERIODS, templateName, type Period, type PeriodicSettings, type WeekStart } from '@shared/templates'
import { IPC } from '@shared/ipc'
import type { SettingsDeps } from '../settings-deps'
import { api } from '../../../app/api'
import { SettingRow } from '../../../ui/SettingRow'
import { Icon } from '../../../ui/Icon'
import { Toggle } from '../../../ui/Toggle'
import { SettingGroup } from './SettingGroup'
import { FolderField } from './TemplateSettings'

const NAMES: Record<Period, { title: string; unit: string; every: string; open: string; hint: string }> = {
  daily: { title: 'Daily', unit: 'day', every: 'Make a note every day', open: 'Open today', hint: 'Named like 2026-10-09.' },
  weekly: {
    title: 'Weekly',
    unit: 'week',
    every: 'Make a note every week',
    open: 'Open this week',
    hint: 'Named like 2026-W41, an ISO week.',
  },
  monthly: { title: 'Monthly', unit: 'month', every: 'Make a note every month', open: 'Open this month', hint: 'Named like 2026-10.' },
  yearly: { title: 'Yearly', unit: 'year', every: 'Make a note every year', open: 'Open this year', hint: 'Named like 2026.' },
}

const NEW_FOLDER = '\u0000new'

/**
 * A folder of the vault, picked from a list, or a new one typed in after
 * choosing "New folder…". A folder that is set but not there yet shows as
 * "(new)": it appears with the first note made in it.
 */
function FolderSelect({
  value,
  folders,
  label,
  onChange,
}: {
  value: string
  folders: readonly string[]
  label: string
  onChange: (folder: string) => void
}): React.ReactElement {
  const [typing, setTyping] = useState(false)
  if (typing)
    return (
      <span className="periodic__new-folder">
        <FolderField
          value=""
          label={label}
          onCommit={(folder) => {
            setTyping(false)
            onChange(folder)
          }}
        />
        <button className="btn btn--ghost btn--sm" onClick={() => setTyping(false)}>
          Cancel
        </button>
      </span>
    )
  const sorted = [...folders].sort((a, b) => a.localeCompare(b))
  return (
    <select
      className="setting__select"
      value={value}
      aria-label={label}
      onChange={(event) => {
        if (event.target.value === NEW_FOLDER) setTyping(true)
        else onChange(event.target.value)
      }}
    >
      {!folders.includes(value) && <option value={value}>{value} (new)</option>}
      {sorted.map((folder) => (
        <option key={folder} value={folder}>
          {folder}
        </option>
      ))}
      <option value={NEW_FOLDER}>New folder…</option>
    </select>
  )
}

/** Which template a period starts from, flagging one that is empty or gone. */
function TemplateSelect({
  value,
  templates,
  label,
  onChange,
}: {
  value: string | null
  templates: readonly string[]
  label: string
  onChange: (template: string | null) => void
}): React.ReactElement {
  return (
    <select
      className="setting__select"
      value={value ?? ''}
      aria-label={label}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">Built-in — just the name as a heading</option>
      {templates.map((path) => (
        <option key={path} value={path}>
          {templateName(path)}
        </option>
      ))}
      {/* A chosen template that is no longer in the folder still shows as
          selected, rather than the select silently reading "Built-in". */}
      {value !== null && !templates.includes(value) && <option value={value}>{templateName(value)} (missing)</option>}
    </select>
  )
}

/** Whether a chosen template has anything in it. */
function useEmptyTemplate(template: string | null): boolean {
  const [empty, setEmpty] = useState(false)
  useEffect(() => {
    if (template === null) {
      setEmpty(false)
      return
    }
    let cancelled = false
    void api.invoke(IPC.fsRead, template).then((result) => {
      if (!cancelled) setEmpty(result.ok && result.content.trim() === '')
    })
    return () => {
      cancelled = true
    }
  }, [template])
  return empty
}

function PeriodGroup({
  period,
  settings,
  set,
  templates,
  folders,
  path,
  onOpen,
}: {
  period: Period
  settings: PeriodicSettings
  set: (next: PeriodicSettings) => void
  templates: readonly string[]
  folders: readonly string[]
  path: string
  onOpen: () => void
}): React.ReactElement {
  const own = settings[period]
  const names = NAMES[period]
  const empty = useEmptyTemplate(own.template)
  const patch = (next: Partial<PeriodicSettings[Period]>): void => set({ ...settings, [period]: { ...own, ...next } })

  return (
    <SettingGroup title={names.title}>
      <SettingRow
        label={names.every}
        hint={`Made the first time Recto is open in a new ${names.unit}, never for one already gone. ${names.hint}`}
      >
        <Toggle on={own.enabled} onChange={() => patch({ enabled: !own.enabled })} label={`${names.title} notes`} />
      </SettingRow>
      {own.enabled && (
        <>
          <SettingRow
            label="Template"
            hint={
              own.template !== null && empty
                ? `${templateName(own.template)} is empty — the built-in heading is used until you write something in it.`
                : `Which template the ${names.unit}'s note starts from.`
            }
          >
            <TemplateSelect
              value={own.template}
              templates={templates}
              label={`${names.title} note template`}
              onChange={(template) => patch({ template })}
            />
          </SettingRow>
          {period === 'weekly' && (
            <SettingRow
              label="Group by month"
              hint="Put weekly notes in month folders even when nothing else needs them. A week belongs to the month of its Thursday."
            >
              <Toggle
                on={settings.groupByMonth}
                onChange={() => set({ ...settings, groupByMonth: !settings.groupByMonth })}
                label="Group weekly notes by month"
              />
            </SettingRow>
          )}
          <SettingRow label="Use a separate folder" hint="Its own folder, with its own year and month folders.">
            <span className="periodic__separate">
              {own.folder !== null && (
                <FolderSelect
                  value={own.folder}
                  folders={folders}
                  label={`${names.title} notes folder`}
                  onChange={(folder) => patch({ folder })}
                />
              )}
              <Toggle
                on={own.folder !== null}
                onChange={() => patch({ folder: own.folder === null ? settings.folder : null })}
                label={`Separate folder for ${names.title.toLowerCase()} notes`}
              />
            </span>
          </SettingRow>
          <div className="daily__preview">
            <span className="daily__label">Current note</span>
            <code className="daily__path">{path}</code>
            <button className="btn btn--ghost btn--sm" onClick={onOpen}>
              <Icon name={period === 'daily' ? 'calendar-days' : period === 'weekly' ? 'calendar-range' : 'calendar'} size={13} />
              {names.open}
            </button>
          </div>
        </>
      )}
    </SettingGroup>
  )
}

/**
 * Periodic notes: a daily, weekly, monthly and yearly note, in one shared
 * folder whose year, month and week folders follow from which periods are on
 * (see `shared/periodic.ts`). The tree at the bottom shows exactly what that
 * means today.
 */
export function PeriodicSettingsTab({ templates, updateTemplates, notes, folders, openPeriodicNote }: SettingsDeps): React.ReactElement {
  const settings = templates.periodic
  const set = (periodic: PeriodicSettings): void => updateTemplates({ ...templates, periodic })
  const inFolder = notes.filter((path) => isInFolder(path, templates.folder))
  const now = new Date()
  const on = PERIODS.filter((p) => settings[p].enabled)
  const paths = on.map((p) => periodNotePath(p, now, settings).path)
  const existing = new Set(notes)

  return (
    <>
      <SettingRow
        label="Folder"
        hint="Shared by every period that has no separate folder. Year, month and week folders are made inside it as needed."
      >
        <FolderSelect
          value={settings.folder}
          folders={folders}
          label="Periodic notes folder"
          onChange={(folder) => set({ ...settings, folder })}
        />
      </SettingRow>
      <SettingRow
        label="Week starts on"
        hint="For {{week_start}} and {{week_end}} in templates. Week notes are ISO weeks, Monday to Sunday."
      >
        <select
          className="setting__select"
          value={settings.weekStart}
          aria-label="Week starts on"
          onChange={(event) => set({ ...settings, weekStart: event.target.value as WeekStart })}
        >
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
          <option value="saturday">Saturday</option>
        </select>
      </SettingRow>

      <p className="setting__note">
        <Icon name="info" size={13} />
        Changing these settings never moves notes you already have: only new notes go where the settings say. Each note links to the one
        above it (day → week → month → year, skipping periods that are off) with a property.
      </p>

      {PERIODS.map((period) => (
        <PeriodGroup
          key={period}
          period={period}
          settings={settings}
          set={set}
          templates={inFolder}
          folders={folders}
          path={periodNotePath(period, now, settings).path}
          onOpen={() => openPeriodicNote(period)}
        />
      ))}

      <section className="periodic__preview" aria-label="Today Recto will create">
        <h3 className="settings__grouphead">Today Recto will create:</h3>
        {paths.length === 0 ? (
          <p className="periodic__none">Nothing — every period is off.</p>
        ) : (
          <p className="periodic__none">The ones not there yet are made when you close Settings.</p>
        )}
        {paths.length > 0 && (
          <ul className="periodic__tree">
            {pathTree(paths).map((line, i) => {
              const full = line.file ? paths.find((p) => p.endsWith(`/${line.name}`)) : undefined
              return (
                <li key={i} className={`periodic__line${line.file ? ' is-file' : ''}`} style={{ paddingLeft: line.depth * 16 }}>
                  <Icon name={line.file ? 'file-text' : 'folder'} size={12} />
                  <span>{line.name}</span>
                  {full !== undefined && existing.has(full) && <span className="periodic__exists">already there</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
