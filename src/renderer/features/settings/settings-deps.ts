/**
 * What every settings tab is handed by the shell.
 */

import type { Appearance } from '../../app/appearance'
import type { VaultInfo } from '@shared/vault'
import type { TemplateSettings } from '@shared/templates'

export type SettingsDeps = {
  appearance: Appearance
  update: (patch: Partial<Appearance>) => void
  vault: VaultInfo
  onCloseVault: () => void
  onSwitchVault: (target: string | null) => Promise<string | null>
  templates: TemplateSettings
  updateTemplates: (next: TemplateSettings) => void
  /** Every note in the vault, so the tab can list what is in the templates folder. */
  notes: readonly string[]
  /** Files in the attachments folder, which the Data tree does not show. */
  attachments: readonly string[]
  openDailyNote: () => void
}
