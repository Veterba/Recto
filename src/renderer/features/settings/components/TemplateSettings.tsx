import { useState, useEffect } from 'react'
import { commands } from '../../../app/commands'
import { normaliseFolder, isInFolder } from '@shared/templates'
import type { SettingsDeps } from '../settings-deps'
import { SettingRow } from '../../../ui/SettingRow'
import { Icon } from '../../../ui/Icon'

/**
 * A vault-relative folder, typed and committed on Enter or blur.
 *
 * Not committed per keystroke: every change creates the folder if it is new,
 * so typing "Templates" letter by letter would leave T/, Te/, Tem/... behind.
 */
export function FolderField({
  value,
  onCommit,
  label,
}: {
  value: string
  onCommit: (folder: string) => void
  label: string
}): React.ReactElement {
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
 * Templates: where they live.
 *
 * The folder is a real, visible folder in the vault - templates are notes you
 * write and edit like any other, so hiding them would only make them harder to
 * find. The periodic notes made from them have their own tab.
 */
export function TemplateSettingsTab({ templates, updateTemplates, notes }: SettingsDeps): React.ReactElement {
  const inFolder = notes.filter((path) => isInFolder(path, templates.folder))

  return (
    <>
      <SettingRow
        label="Templates folder"
        hint={
          inFolder.length === 0
            ? 'In your vault, next to your notes. Empty so far — any note you put here becomes a template.'
            : `${inFolder.length} ${inFolder.length === 1 ? 'template' : 'templates'} here. Insert one into any note${commands.label('editor:template') === null ? ' from the command palette' : ` with ${commands.label('editor:template')}`}.`
        }
      >
        <FolderField value={templates.folder} label="Templates folder" onCommit={(folder) => updateTemplates({ ...templates, folder })} />
      </SettingRow>

      <p className="setting__note">
        <Icon name="layout-template" size={13} />
        Changing the folder points Recto at a different one; it does not move the templates you already have. Placeholders filled in on
        insert: <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{date:+7}}'}</code>,{' '}
        <code>{'{{week}}'}</code>, <code>{'{{month}}'}</code>, <code>{'{{year}}'}</code>, <code>{'{{week_start}}'}</code>,{' '}
        <code>{'{{week_end}}'}</code>. Daily, weekly, monthly and yearly notes are under Periodic notes.
      </p>
    </>
  )
}
