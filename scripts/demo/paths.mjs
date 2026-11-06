// Where the demo lives, and the moment it is set in. Outside the repo and the real vault.

import os from 'node:os'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const DEMO_HOME = path.join(os.homedir(), 'Recto-demo')
export const VAULT = path.join(DEMO_HOME, 'vault')
export const RECORDINGS = path.join(DEMO_HOME, 'recordings')
/** The copy a shot runs on. Its path is on screen in the overview, so it says nothing about this Mac. */
export const RUN_VAULT = '/Users/Shared/Notes'
/** The saved answers of the real model, replayed in the AI shots. */
export const AI_TAPE = path.join(DEMO_HOME, 'ai-tape.json')
/** "Today" in every shot: the daily notes and the clock agree with it on any run. */
export const DEMO_NOW = new Date('2026-11-06T10:00:00')
