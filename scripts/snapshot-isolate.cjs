// Loaded into the main process of every Electron the snapshot script starts
// (`electron -r`), before the app's own code: the run never takes
// the screen, the keyboard or the mouse from whoever is working. Launched
// normally, Electron is the frontmost app for a second or two, and whatever is
// typed then - ⌘2, ⌘N - lands in the app being photographed. Playwright drives
// the page over the DevTools protocol, which needs none of this.
const { app } = require('electron')

if (process.platform === 'darwin') app.setActivationPolicy('prohibited')
app.on('browser-window-created', (_event, window) => {
  window.setFocusable(false)
  window.setIgnoreMouseEvents(true)
})
app.whenReady().then(() => app.hide())
