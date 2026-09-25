import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isInside } from './paths'

/**
 * Dev builds never touch real notes.
 *
 * `npm run dev` is started, forgotten, and left running while the code under
 * it changes - and it hot-reloads that code into whatever vault it has open.
 * So unless `RECTO_ALLOW_REAL_VAULT=1` is set, a dev build keeps its own app
 * state, opens a copy of any vault it is pointed at, and never lifts the
 * topics first-write gate. A packaged app is unaffected.
 */
export const devGuarded = (): boolean => !app.isPackaged && process.env['RECTO_ALLOW_REAL_VAULT'] !== '1'

/**
 * Call before anything reads userData. A dev build gets its own ("Recto (dev)"),
 * so it never shares the installed app's last vault. The model is shared - it is
 * the same immutable files, and 219 MB is not worth downloading twice.
 */
export function isolateDevState(): void {
  if (!devGuarded() || app.commandLine.hasSwitch('user-data-dir')) return
  const shared = app.getPath('userData')
  process.env['RECTO_MODEL_DIR'] ??= path.join(shared, 'models')
  app.setPath('userData', `${shared} (dev)`)
}

const copiesRoot = (): string => path.join(app.getPath('userData'), 'dev-vault-copies')

/**
 * The folder a dev build actually opens: a copy of `dir`, made once. The
 * index and version history are left behind - a cache, rebuilt on open.
 */
export function devVaultPath(dir: string): string {
  if (!devGuarded() || isInside(copiesRoot(), dir)) return dir
  const copy = path.join(copiesRoot(), path.basename(dir))
  if (!fs.existsSync(copy)) {
    fs.cpSync(dir, copy, {
      recursive: true,
      filter: (source) => !/[\\/]\.recto[\\/](index\.db(-wal|-shm)?|archive)$/.test(source) && !/[\\/]\.git$/.test(source),
    })
  }
  return copy
}
