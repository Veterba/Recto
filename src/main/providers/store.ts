import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Provider credentials: the OpenAI key and the ChatGPT sign-in. The same
 * rules as the Anthropic key (main/secrets.ts): in the app's own folder, never
 * the vault; encrypted with the Keychain; never sent to the renderer.
 */

export type SecretStore = {
  read(name: string): string | null
  write(name: string, value: string | null): { ok: boolean; error?: string }
}

const file = (name: string): string => path.join(app.getPath('userData'), `provider-${name}.bin`)

export const keychainStore: SecretStore = {
  read(name) {
    try {
      return safeStorage.decryptString(fs.readFileSync(file(name)))
    } catch {
      return null
    }
  },
  write(name, value) {
    try {
      if (value === null) {
        fs.rmSync(file(name), { force: true })
        return { ok: true }
      }
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This system has no secure storage, so nothing can be saved.' }
      // Written aside and moved in: a crash mid-write never leaves half a sign-in.
      const aside = `${file(name)}.tmp`
      fs.writeFileSync(aside, safeStorage.encryptString(value), { mode: 0o600 })
      fs.renameSync(aside, file(name))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}
