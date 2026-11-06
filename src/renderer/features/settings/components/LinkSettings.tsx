import { useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import { OBSIDIAN_DEFAULTS, type LinkSettings as Settings } from '@shared/obsidian-links'
import { api } from '../../../app/api'
import { SettingGroup } from '../../../ui/SettingGroup'
import { SettingRow } from '../../../ui/SettingRow'

/**
 * How links are written and kept: Obsidian's own "Files and links" settings
 * for this vault, read from `.obsidian/app.json` (or Obsidian's defaults when
 * there is none). Shown, not changed here - they are Obsidian's, so both apps
 * write links the same way. "Always update" in the Update links dialog is the
 * one thing that turns one on, as in Obsidian.
 */
const FORMAT: Record<Settings['newLinkFormat'], string> = {
  shortest: 'Shortest path when possible',
  relative: 'Relative path to file',
  absolute: 'Absolute path in vault',
}

export function LinkSettings(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(OBSIDIAN_DEFAULTS)
  useEffect(() => {
    void api.invoke(IPC.linksSettings).then(setSettings)
  }, [])
  return (
    <SettingGroup title="Obsidian’s settings for this vault">
      <SettingRow label="New link format" hint="The name alone when no other note has it, else its path - or as set in Obsidian.">
        <span className="setting__hint">{FORMAT[settings.newLinkFormat]}</span>
      </SettingRow>
      <SettingRow label="Use [[Wikilinks]]" hint="Off: links are written as Markdown links, [Name](Folder/Name.md).">
        <span className="setting__hint">{settings.useMarkdownLinks ? 'Off' : 'On'}</span>
      </SettingRow>
      <SettingRow label="Automatically update internal links" hint="Off: Recto asks before it changes the links to a note you rename or move.">
        <span className="setting__hint">{settings.alwaysUpdateLinks ? 'On' : 'Off'}</span>
      </SettingRow>
      <SettingRow label="Where they are set" hint="In Obsidian: Settings → Files and links. Recto reads them from .obsidian/app.json; it changes one only when you answer “Always update” to Update links, as Obsidian does.">
        <span />
      </SettingRow>
    </SettingGroup>
  )
}
