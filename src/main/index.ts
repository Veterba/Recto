import { app, BrowserWindow } from 'electron'
import { isolateDevState } from './dev-guard'
import { registerIpc } from './ipc'
import { handleVaultScheme, registerVaultScheme } from './vault-protocol'
import { createWindow } from './window'

app.setName('Recto')
// Before anything reads userData: a dev build keeps its own state (see dev-guard).
isolateDevState()

// Before ready, or the scheme is registered without its privileges and every
// image load fails as an opaque cross-origin request.
registerVaultScheme()

// One instance, one vault. A second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
