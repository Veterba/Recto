// A bare Electron window on RECTO_URL, for pages the snapshot script shoots
// outside the app (the dev-only bot design page). Hidden: it never takes the screen.
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 900, height: 600, show: false })
  window.loadURL(process.env.RECTO_URL)
})
