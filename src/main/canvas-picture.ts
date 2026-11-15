import { BrowserWindow } from 'electron'

/**
 * A canvas's SVG (shared/canvas-picture.ts) as a PNG a model can look at:
 * drawn in a hidden window that never shows - its own page only, no scripts
 * - captured, and closed. One at a time; null when it cannot be drawn, and
 * the tool goes on without the picture.
 */

let turn: Promise<unknown> = Promise.resolve()

export function svgToPng(svg: string, width: number, height: number): Promise<Buffer | null> {
  const run = turn.then(() => draw(svg, width, height))
  turn = run.catch(() => undefined)
  return run
}

async function draw(svg: string, width: number, height: number): Promise<Buffer | null> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true },
  })
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;overflow:hidden">${svg}</body></html>`)}`,
    )
    // One frame painted before it is taken: an offscreen page draws after it loads.
    await new Promise((resolve) => setTimeout(resolve, 120))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    return image.isEmpty() ? null : image.toPNG()
  } catch (err) {
    console.error('[canvas picture]', err)
    return null
  } finally {
    win.destroy()
  }
}
