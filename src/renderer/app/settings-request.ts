import type { SettingsTab } from '../features/settings'

/**
 * Open Settings at a tab, from anywhere - a chat's "Sign in" or "Turn on"
 * link. The shell, which owns the Settings panel, sets what it does.
 */

let handler: ((tab?: SettingsTab) => void) | null = null

export function setSettingsHandler(next: typeof handler): void {
  handler = next
}

export function openSettingsAt(tab?: SettingsTab): void {
  handler?.(tab)
}
