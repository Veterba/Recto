import { cancelAllQuickAsk } from './providers/quick-ask'
import { app, BrowserWindow } from 'electron'
import { runEvalJob } from './bots/eval-mode'
import * as bots from './bots'
import { evalJob } from './config'
import { isolateDevState } from './dev-guard'
import { registerIpc } from './ipc'
import { handleVaultScheme, registerVaultScheme } from './vault-protocol'
import { createWindow } from './window'
import { flushWindows, markQuitting } from './flush'
import { writeLauncher } from './vault-tools/launcher'
import { startMcpSocket, stopMcpSocket } from './vault-tools/socket'

app.setName('Recto')
// Before anything reads userData: a dev build keeps its own state (see dev-guard).
isolateDevState()

// Before ready, or the scheme is registered without its privileges and every
// image load fails as an opaque cross-origin request.
registerVaultScheme()

const job = evalJob()
if (job !== undefined) {
  // The bot evals: no window, no single-instance lock (its profile is a scratch
  // one, beside whatever Recto is open), quit when the cases are answered.
  void app.whenReady().then(() =>
    runEvalJob(job).then(
      () => app.quit(),
      (err: unknown) => {
        console.error('[eval]', err instanceof Error ? err.message : err)
        app.exit(1)
      },
    ),
  )
} else if (!app.requestSingleInstanceLock()) {
  // One instance, one vault. A second launch focuses the existing window.
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    handleVaultScheme()
    registerIpc()
    createWindow()
    // AI clients reach Recto through these (main/vault-tools): the launcher
    // they run, refreshed every start, and the socket it talks to.
    try {
      writeLauncher()
    } catch (err) {
      console.error('[mcp] launcher', err)
    }
    startMcpSocket().catch((err: unknown) => console.error('[mcp] socket', err))
    app.on('will-quit', stopMcpSocket)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // An answer running is stopped and saved (marked interrupted) first; then the model, kept
  // loaded while the app is open, goes when the app does.
  let unloaded = false
  app.on('before-quit', (event) => {
    if (unloaded) return
    event.preventDefault()
    unloaded = true
    // Quick ask's runs too: a CLI left running after the app has gone goes on answering, and spending, to no one.
    cancelAllQuickAsk()
    markQuitting()
    // What is typed and not saved yet is written first (flush.ts).
    void flushWindows()
      .then(() => bots.stopAnswers())
      .then(() => Promise.race([bots.unloadOnQuit(), new Promise((resolve) => setTimeout(resolve, 1500))]))
      .finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
