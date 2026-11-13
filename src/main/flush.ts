import { BrowserWindow } from 'electron'
import { IPC_EVENT } from '../shared/ipc'
import { sendEvent } from './events'
import * as vaultFs from './vault-fs'

/**
 * Nothing typed is lost to quitting or closing the window. A note saves half a
 * second after the last key; ⌘Q in that half second used to end the app with
 * the words still only on screen. So before a window goes, its renderer is
 * asked to save everything (it lets go of the vault view, and every open note,
 * canvas card and setting writes itself, as it does on closing a tab), and
 * says when it has; the writes it sent are waited for, then the window goes.
 */

/** How long a window that does not answer is waited for. */
const FLUSH_TIMEOUT_MS = 2000

const waiting = new Set<() => void>()

/** The renderer's answer: everything is sent. Done once those writes are on disk. */
export async function flushed(): Promise<void> {
  await vaultFs.writesSettled()
  for (const done of [...waiting]) done()
}

/** Ask the windows to save, and wait for the answer - or, if none comes, a while. */
export function flushWindows(windows: readonly BrowserWindow[] = BrowserWindow.getAllWindows(), timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  const open = windows.filter((w) => !w.isDestroyed())
  if (open.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      waiting.delete(done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    waiting.add(done)
    for (const win of open) sendEvent(win, IPC_EVENT.appFlush)
  })
}

let quitting = false
/** Set by quit, which saves every window first: a window closing then is not held back again (that would cancel the quit). */
export const markQuitting = (): void => {
  quitting = true
}

/** A window closed by itself (⌘W, the red button) saves first, then closes. */
export function flushOnClose(win: BrowserWindow): void {
  let saved = false
  win.on('close', (event) => {
    if (saved || quitting) return
    event.preventDefault()
    saved = true
    void flushWindows([win]).finally(() => {
      if (!win.isDestroyed()) win.close()
    })
  })
}
