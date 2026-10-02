// Loaded into the main process of every Electron the snapshot script starts
// (`electron -r`), before the app's own code: the run never takes the screen,
// the keyboard or the mouse from whoever is working.
//
// Its windows are never shown at all. Hiding one after it appears is too late:
// a tiling window manager (AeroSpace) has already made room for it and pushed
// the user's own windows aside. Playwright reads and drives the page over the
// DevTools protocol, and a window that was never shown still renders, so
// nothing here needs one on screen. And whatever is typed while Electron would
// have been frontmost - ⌘2, ⌘N - never lands in the app being photographed.
const { app, BrowserWindow } = require('electron')

if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
for (const method of ['show', 'showInactive', 'focus', 'moveTop']) BrowserWindow.prototype[method] = function () {}
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.setIgnoreMouseEvents(true)
})
app.whenReady().then(() => app.hide())
