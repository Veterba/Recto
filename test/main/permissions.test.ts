import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: {} }))
const { allowedPermission } = await import('../../src/main/permissions')

/** Chromium grants whatever a page asks unless told otherwise: Recto allows the clipboard and full screen, nothing more. */
describe('permissions', () => {
  it('the clipboard and full screen, and nothing else', () => {
    for (const p of ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']) expect(allowedPermission(p), p).toBe(true)
    for (const p of ['media', 'geolocation', 'notifications', 'midiSysex', 'openExternal', 'display-capture', 'hid', 'serial', 'usb'])
      expect(allowedPermission(p), p).toBe(false)
  })
})
