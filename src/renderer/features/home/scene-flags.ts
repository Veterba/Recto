/**
 * Debug switches for the home scene, read from the URL, and the handle it
 * exposes to tests and the console.
 */

/**
 * Debug switches: `?noGrain&freeze&readback&noInput&glassTest&noFringe&flatField`.
 *
 * Also settable as `localStorage.homeFlags` - a JSON object - because the app
 * is not loaded from a URL anyone can edit: a packaged Electron renderer has
 * no address bar to put a query string in. Stored rather than held on `window`
 * so it survives a reload, which is exactly when a debug switch is most
 * annoying to lose.
 *
 * `readback` is the one that costs something: it keeps the drawing buffer
 * alive after compositing so a measurement can copy the canvas out. Nothing
 * can measure what the screen shows without it, and it is never on in normal
 * use.
 */
export type SceneFlags = {
  noGrain: boolean
  freeze: boolean
  readback: boolean
  /** Ignore the pointer, so a measurement cannot be polluted by a real mouse. */
  noInput: boolean
  /** Page two's glass over black/white stripes and a word, to check the lens. */
  glassTest: boolean
  /** Page two's glass without its colour split, to measure the split alone. */
  noFringe: boolean
  /** Page two's glass over flat grey, to check the rims read without an image. */
  flatField: boolean
}

export function readFlags(search = window.location.search): SceneFlags {
  const params = new URLSearchParams(search)
  let forced: Partial<SceneFlags> = {}
  try {
    const stored = window.localStorage.getItem('homeFlags')
    if (stored !== null) forced = JSON.parse(stored) as Partial<SceneFlags>
  } catch {
    // A hand-edited value that is not JSON is not a reason to fail to open.
  }
  const on = (name: keyof SceneFlags): boolean => forced[name] === true || params.has(name)
  return {
    noGrain: on('noGrain'),
    freeze: on('freeze'),
    readback: on('readback'),
    noInput: on('noInput'),
    glassTest: on('glassTest'),
    noFringe: on('noFringe'),
    flatField: on('flatField'),
  }
}

/** What a measurement can ask the scene about itself. */
export type SceneDebug = {
  /** Every live depth shape: nominal sigma, drawn sigma, amplitude, centre. */
  shapes: () => { x: number; y: number; nominal: number; sigma: number; amp: number }[]
  /** The lifecycle's own estimate of how much of the page is deep. */
  coverage: () => number
  /** Where the shader believes the pages are, 0 to 1. */
  progress: () => number
  /** Frames drawn since the scene was created. */
  frames: () => number
  /** Turn a switch on or off without reopening. */
  setFlags: (next: Partial<SceneFlags>) => void
  /**
   * How long the GPU spent on the last completed frame, in milliseconds.
   *
   * Null where the driver will not say - `EXT_disjoint_timer_query_webgl2` is
   * unavailable on plenty of machines, and on some it is present but returns
   * disjoint results, which are discarded rather than reported as fact.
   */
  gpuMs: () => number | null
}
