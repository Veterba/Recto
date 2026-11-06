import { useSyncExternalStore } from 'react'
import type { StrokeKind } from './drawing'

/**
 * What the Draw tool draws with: a pen or a highlighter, each with its own
 * size and colour, as you left them - a convenience of this Mac's, so the
 * browser's storage, and fine to lose.
 */

export type PenSize = 'S' | 'M' | 'L' | 'XL'
/** The eraser: `cut` takes out only what it passes over; `whole` takes the whole stroke it touches. */
export type EraserMode = 'cut' | 'whole'
export type PenSettings = {
  kind: StrokeKind
  pen: { size: PenSize; color: string | null }
  highlighter: { size: PenSize; color: string }
  eraser: EraserMode
}

/** Widths in canvas units: a highlighter's band is wider than a line. */
const WIDTH: Record<StrokeKind, Record<PenSize, number>> = {
  pen: { S: 2, M: 4, L: 8, XL: 14 },
  highlighter: { S: 10, M: 16, L: 24, XL: 34 },
}
export const PEN_SIZES: readonly PenSize[] = ['S', 'M', 'L', 'XL']

/** The swatches: ink (null - the theme's text colour on the canvas, near-black in the file) and five colours that read on light and dark. */
export const PEN_COLORS: readonly (string | null)[] = [null, '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8']
export const HIGHLIGHT_COLORS: readonly string[] = ['#fab005', '#82c91e', '#22b8cf', '#f783ac', '#ff922b', '#b197fc']

const KEY = 'recto.canvas-pen'
const DEFAULT: PenSettings = { kind: 'pen', pen: { size: 'M', color: null }, highlighter: { size: 'M', color: '#fab005' }, eraser: 'cut' }

function load(): PenSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PenSettings> | null
    if (raw === null) return DEFAULT
    return {
      kind: raw.kind === 'highlighter' ? 'highlighter' : 'pen',
      pen: { ...DEFAULT.pen, ...raw.pen },
      highlighter: { ...DEFAULT.highlighter, ...raw.highlighter },
      eraser: raw.eraser === 'whole' ? 'whole' : 'cut',
    }
  } catch {
    return DEFAULT
  }
}

let current = load()
const listeners = new Set<() => void>()

export function setPen(next: PenSettings): void {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Not kept: next time it starts from the defaults.
  }
  for (const l of listeners) l()
}

export const pen = (): PenSettings => current

export const usePen = (): PenSettings =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )

/** What a stroke drawn now is drawn with. */
export function strokeStyle(settings: PenSettings): { kind: StrokeKind; color: string | null; size: number } {
  const s = settings[settings.kind]
  return { kind: settings.kind, color: s.color, size: WIDTH[settings.kind][s.size] }
}
