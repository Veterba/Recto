import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { VIBRANCY_MATERIALS, type VibrancyMaterial } from '@shared/ipc-contract'

/**
 * Appearance and shell layout, persisted to `.recto/appearance.json`.
 *
 * Kept separate from workspace.json: the layout of your tabs is a different
 * concern from what colour the app is, and one JSON file per feature means you
 * can delete one without losing the other.
 */

export type Theme = 'system' | 'light' | 'dark'

export type Appearance = {
  theme: Theme
  sidebarWidth: number
  sidebarOpen: boolean
  /** Live Preview hides markdown markers away from the cursor. */
  livePreview: boolean
  /** Editor font size in px. */
  fontSize: number
  /** Monospace suits markdown source; serif/sans suit long-form reading. */
  editorFont: 'mono' | 'sans' | 'serif'
  /** Headings can use a different family from the body - a serif over a sans. */
  headingFont: 'match' | 'mono' | 'sans' | 'serif'
  /**
   * How much bigger headings are than body text, as a ratio between levels.
   * One number drives H1-H6, so the document's structure gets louder or
   * quieter as a whole instead of six sliders that can disagree.
   */
  headingScale: number
  /** Modal editing, for people who type that way. */
  vimMode: boolean
  /**
   * macOS vibrancy and glass surfaces.
   *
   * A switch rather than a decree: blurring the desktop through the window is
   * lovely over a plain wallpaper and genuinely hard to read over a busy one,
   * and that is the user's call, not the app's.
   */
  translucent: boolean
  /**
   * How much of the blurred desktop shows through, 0-100.
   *
   * Not a blur radius: macOS fixes that per vibrancy material and offers no way
   * to change it. What this actually moves is the opacity of the app's own
   * surfaces - which is the only honest thing a "blur strength" control can do
   * here, and it is the knob that visibly matters.
   */
  blurStrength: number
  /**
   * Which macOS material does the blurring.
   *
   * Unlike `blurStrength` - which is really transparency - this changes the
   * blur itself, because each material has its own radius and tint baked into
   * AppKit. It is the only honest way to make the blur stronger or weaker.
   */
  vibrancy: VibrancyMaterial
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  sidebarWidth: 260,
  sidebarOpen: true,
  livePreview: true,
  fontSize: 14,
  editorFont: 'mono',
  headingFont: 'match',
  headingScale: 1.25,
  vimMode: false,
  translucent: true,
  blurStrength: 80,
  vibrancy: 'sidebar',
}

/**
 * Apply to the document.
 *
 * The accent used to be user-selectable. It is not any more, by choice: two
 * themes and one accent is a decision the app makes so that every surface,
 * every highlight and every future glass tint can be designed against a known
 * colour rather than an arbitrary hue. Strict, and better for it.
 */
const FONT_STACKS: Record<Appearance['editorFont'], string> = {
  mono: 'var(--font-mono)',
  sans: 'var(--font-ui)',
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Palatino Linotype", serif',
}

/**
 * Vibrancy is macOS-only, and without it a translucent window is just an
 * unreadable one - the desktop would show through raw and unblurred. Checked
 * from the user agent rather than over IPC so it is available synchronously,
 * before the first paint.
 */
const SUPPORTS_VIBRANCY = /Mac OS X/.test(navigator.userAgent)

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance.theme)
  // The editor reads these two through the theme, so changing them repaints it
  // without the editor being rebuilt.
  root.style.setProperty('--editor-font-size', `${appearance.fontSize}px`)
  root.style.setProperty('--font-editor', FONT_STACKS[appearance.editorFont])
  root.style.setProperty(
    '--font-heading',
    appearance.headingFont === 'match' ? 'inherit' : FONT_STACKS[appearance.headingFont],
  )
  // One ratio, six levels. H1 is scale^3 above the body, H3 is scale^1, and
  // H4-H6 sit at or below it - which is what those levels are for.
  root.style.setProperty('--heading-scale', String(appearance.headingScale))
  // One attribute swaps every translucent token for its opaque equivalent.
  if (appearance.translucent && SUPPORTS_VIBRANCY) {
    root.removeAttribute('data-translucent')
    // At 0 the app is opaque; at 100 it is mostly backdrop. The chrome goes
    // further than the editor, because window furniture can afford to be
    // ghostly and a paragraph of text cannot.
    /**
     * The sidebar, and only the sidebar. The editor is opaque, always - a page
     * of prose sitting on top of the desktop is not a look worth having.
     */
    const t = Math.min(100, Math.max(0, appearance.blurStrength)) / 100
    // Floors at 0.28: below that the light text has no panel to sit on, and the
    // control is about how much backdrop shows, not whether the sidebar exists.
    root.style.setProperty('--sidebar-alpha', (1 - t * 0.72).toFixed(3))
    // Grain earns its keep in proportion to how much backdrop there is.
    root.style.setProperty('--grain-opacity', (0.18 + t * 0.42).toFixed(3))
  } else {
    root.setAttribute('data-translucent', 'off')
    root.style.removeProperty('--sidebar-alpha')
    root.style.removeProperty('--grain-opacity')

  }
}

function coerce(value: unknown): Appearance {
  if (typeof value !== 'object' || value === null) return DEFAULT_APPEARANCE
  const v = value as Partial<Appearance>
  const theme: Theme = v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : DEFAULT_APPEARANCE.theme
  return {
    theme,
    sidebarWidth: typeof v.sidebarWidth === 'number' ? Math.min(520, Math.max(180, v.sidebarWidth)) : DEFAULT_APPEARANCE.sidebarWidth,
    sidebarOpen: typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : DEFAULT_APPEARANCE.sidebarOpen,
    livePreview: typeof v.livePreview === 'boolean' ? v.livePreview : DEFAULT_APPEARANCE.livePreview,
    fontSize:
      typeof v.fontSize === 'number' && v.fontSize >= 11 && v.fontSize <= 24
        ? v.fontSize
        : DEFAULT_APPEARANCE.fontSize,
    headingFont:
      v.headingFont === 'mono' || v.headingFont === 'sans' || v.headingFont === 'serif' || v.headingFont === 'match'
        ? v.headingFont
        : DEFAULT_APPEARANCE.headingFont,
    headingScale:
      typeof v.headingScale === 'number' && Number.isFinite(v.headingScale)
        ? Math.min(1.6, Math.max(1, v.headingScale))
        : DEFAULT_APPEARANCE.headingScale,
    vimMode: typeof v.vimMode === 'boolean' ? v.vimMode : DEFAULT_APPEARANCE.vimMode,
    translucent: typeof v.translucent === 'boolean' ? v.translucent : DEFAULT_APPEARANCE.translucent,
    blurStrength:
      typeof v.blurStrength === 'number' && Number.isFinite(v.blurStrength)
        ? Math.min(100, Math.max(0, v.blurStrength))
        : DEFAULT_APPEARANCE.blurStrength,
    vibrancy: VIBRANCY_MATERIALS.includes(v.vibrancy as VibrancyMaterial)
      ? (v.vibrancy as VibrancyMaterial)
      : DEFAULT_APPEARANCE.vibrancy,
    editorFont:
      v.editorFont === 'mono' || v.editorFont === 'sans' || v.editorFont === 'serif'
        ? v.editorFont
        : DEFAULT_APPEARANCE.editorFont,
  }
}

export function useAppearance(): {
  appearance: Appearance
  ready: boolean
  update: (patch: Partial<Appearance>) => void
} {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE)
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void api.invoke('state:read', 'appearance').then((saved) => {
      if (cancelled) return
      const next = coerce(saved)
      applyAppearance(next)
      // The material lives in the window, not the document, so it has to be
      // pushed to main rather than written into a CSS variable.
      void api.invoke('app:set-vibrancy', next.vibrancy)
      setAppearance(next)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch }
      applyAppearance(next)
      if (patch.vibrancy !== undefined) void api.invoke('app:set-vibrancy', next.vibrancy)
      window.clearTimeout(saveTimer.current)
      // Dragging the sidebar fires this every frame; only the last one matters.
      saveTimer.current = window.setTimeout(() => {
        void api.invoke('state:write', 'appearance', next)
      }, 300)
      return next
    })
  }, [])

  return { appearance, ready, update }
}
