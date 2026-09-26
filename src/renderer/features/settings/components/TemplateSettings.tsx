import { useState, useEffect } from 'react'
import { normaliseFolder, isInFolder, dailyNotePath, type TemplateSettings, templateName } from '@shared/templates'
import type { SettingsDeps } from '../settings-deps'
import { api } from '../../../app/api'
import { IPC } from '@shared/ipc'
import { SettingRow } from '../../../ui/SettingRow'
import { Icon } from '../../../ui/Icon'
import { SettingGroup } from './SettingGroup'
import { Toggle } from '../../../ui/Toggle'

/**
 * A vault-relative folder, typed and committed on Enter or blur.
 *
 * Not committed per keystroke: every change creates the folder if it is new,
 * so typing "Templates" letter by letter would leave T/, Te/, Tem/... behind.
 */
function FolderField({ value, onCommit, label }: { value: string; onCommit: (folder: string) => void; label: string }): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const normalised = normaliseFolder(draft)
  const invalid = draft.trim() !== '' && normalised === null

  const commit = (): void => {
    if (normalised === null) {
      setDraft(value)
      return
    }
    // Only the case differs from what is set: on a Mac disk that IS the same
    // folder, so nothing changes - and the field shows the folder's real name
    // rather than keeping the spelling that was typed.
    if (normalised.toLowerCase() === value.toLowerCase()) setDraft(value)
    else onCommit(normalised)
  }

  return (
    <input
      className={`dialog__input setting__path${invalid ? ' is-invalid' : ''}`}
      value={draft}
      spellCheck={false}
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * Templates: where they live, and the daily note made from one.
 *
 * The folder is a real, visible folder in the vault - templates are notes you
 * write and edit like any other, so hiding them would only make them harder to
 * find. The daily note is the one template the app uses on its own.
 */
export function TemplateSettingsTab({ templates, updateTemplates, notes, openDailyNote }: SettingsDeps): React.ReactElement {
  const inFolder = notes.filter((path) => isInFolder(path, templates.folder))
  /** Whether the chosen daily template has anything in it. */
  const [chosenEmpty, setChosenEmpty] = useState(false)
  useEffect(() => {
    const chosen = templates.daily.template
    if (chosen === null) {
      setChosenEmpty(false)
      return
    }
    let cancelled = false
    void api.invoke(IPC.fsRead, chosen).then((result) => {
      if (!cancelled) setChosenEmpty(result.ok && result.content.trim() === '')
    })
    return () => {
      cancelled = true
    }
  }, [templates.daily.template])
  const today = dailyNotePath(new Date(), templates.daily.folder)
  const setDaily = (patch: Partial<TemplateSettings['daily']>): void =>
    updateTemplates({ ...templates, daily: { ...templates.daily, ...patch } })

  return (
    <>
      <SettingRow
        label="Templates folder"
        hint={
          inFolder.length === 0
            ? 'In your vault, next to your notes. Empty so far — any note you put here becomes a template.'
            : `${inFolder.length} ${inFolder.length === 1 ? 'template' : 'templates'} here. Insert one into any note with ⌘⇧T.`
        }
      >
        <FolderField value={templates.folder} label="Templates folder" onCommit={(folder) => updateTemplates({ ...templates, folder })} />
      </SettingRow>

      <p className="setting__note">
        <Icon name="layout-template" size={13} />
        Changing the folder points Recto at a different one; it does not move the templates you already have. Placeholders filled in on
        insert: <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{date:+7}}'}</code>.
      </p>

      <SettingGroup title="Daily note">
        <SettingRow
          label="Make a note every day"
          hint="Created automatically the first time Recto is open on a new day. It is not opened for you."
        >
          <Toggle on={templates.daily.enabled} onChange={() => setDaily({ enabled: !templates.daily.enabled })} label="Daily note" />
        </SettingRow>

        {templates.daily.enabled && (
          <>
            <SettingRow
              label="Template"
              hint={
                chosenEmpty
                  ? `${templateName(templates.daily.template ?? '')} is empty — daily notes use the built-in heading until you write something in it.`
                  : "Which template today's note starts from."
              }
            >
              <select
                className="setting__select"
                value={templates.daily.template ?? ''}
                aria-label="Daily note template"
                onChange={(event) => setDaily({ template: event.target.value === '' ? null : event.target.value })}
              >
                <option value="">Built-in — just the date as a heading</option>
                {inFolder.map((path) => (
                  <option key={path} value={path}>
                    {templateName(path)}
                  </option>
                ))}
                {/* A chosen template that is no longer in the folder still shows
                    as selected, rather than the select silently reading "Built-in". */}
                {templates.daily.template !== null && !inFolder.includes(templates.daily.template) && (
                  <option value={templates.daily.template}>{templateName(templates.daily.template)} (missing)</option>
                )}
              </select>
            </SettingRow>

            <SettingRow label="Folder" hint="Year, month and week folders are made inside it as the days go by.">
              <FolderField value={templates.daily.folder} label="Daily notes folder" onCommit={(folder) => setDaily({ folder })} />
            </SettingRow>

            <div className="daily__preview">
              <span className="daily__label">Today's note</span>
              <code className="daily__path">{today.path}</code>
              <button className="btn btn--ghost btn--sm" onClick={openDailyNote}>
                <Icon name="calendar-days" size={13} />
                Open
              </button>
            </div>
          </>
        )}
      </SettingGroup>
    </>
  )
}
