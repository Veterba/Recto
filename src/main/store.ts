import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Per-user app state, in userData - NOT in the vault and NOT in the bundle.
 * Nothing machine-specific ships with the app; this file is written at runtime.
 */
type AppState = {
  lastVaultPath?: string
}

const file = () => path.join(app.getPath('userData'), 'app-state.json')

export function readState(): AppState {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as AppState
  } catch {
    return {}
  }
}

/** `undefined` in the patch clears that key - that's how "close vault" forgets it. */
export function writeState(patch: { [K in keyof AppState]?: AppState[K] | undefined }): void {
  const next = { ...readState(), ...patch }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
}
