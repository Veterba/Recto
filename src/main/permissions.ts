import { session } from 'electron'

/**
 * What a page in Recto may ask Chromium for. Everything else - camera,
 * microphone, location, notifications, MIDI, opening other apps' links - is
 * refused without asking: a note's HTML or an embedded video has no business
 * with it, and Electron's default is to grant whatever is asked.
 */
const ALLOWED = new Set([
  // The canvas pastes what was copied; copying is everywhere.
  'clipboard-read',
  'clipboard-sanitized-write',
  // A video full screen.
  'fullscreen',
])

export const allowedPermission = (permission: string): boolean => ALLOWED.has(permission)

/** Must run after ready. */
export function limitPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowedPermission(permission)))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowedPermission(permission))
}
