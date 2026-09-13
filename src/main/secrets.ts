import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The API key, and nothing else.
 *
 * Three rules, all of them load-bearing:
 *
 * 1. It lives in `userData`, **not in the vault**. A vault is a folder people
 *    sync, push to git and hand to other machines; a secret in it is a secret
 *    published the first time they do.
 * 2. It is encrypted with `safeStorage`, which on macOS is the Keychain. A
 *    plaintext file readable by every process the user runs is not storage.
 * 3. It never crosses to the renderer. The renderer asks main to *use* the key
 *    and gets a masked hint back for the settings screen - never the key.
 *
 * Bring-your-own-key, so there is nothing here at build time and nothing shared
 * between users.
 */

const FILE = (): string => path.join(app.getPath('userData'), 'secrets.bin')

/** Last four characters, the way every other app shows a stored key. */
function hintFor(key: string): string {
  const tail = key.slice(-4)
  return `sk-ant-…${tail}`
}

let cached: string | null | undefined

export function keyAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function readKey(): string | null {
  if (cached !== undefined) return cached
  try {
    const encrypted = fs.readFileSync(FILE())
    cached = safeStorage.decryptString(encrypted)
  } catch {
    // Missing, or encrypted by a keychain we can no longer open. Either way
    // there is no key to use, and the settings screen will say so.
    cached = null
  }
  return cached
}

export function writeKey(key: string): { ok: boolean; error?: string } {
  const trimmed = key.trim()
  if (trimmed === '') return { ok: false, error: 'Paste a key first.' }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'This system has no secure storage available, so the key cannot be saved.' }
  }
  try {
    fs.writeFileSync(FILE(), safeStorage.encryptString(trimmed), { mode: 0o600 })
    cached = trimmed
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function clearKey(): void {
  try {
    fs.rmSync(FILE(), { force: true })
  } catch {
    // Already gone is the outcome we wanted.
  }
  cached = null
}

export function keyStatus(): { present: boolean; hint: string | null; available: boolean } {
  const key = readKey()
  return {
    present: key !== null,
    hint: key === null ? null : hintFor(key),
    available: keyAvailable(),
  }
}
