import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

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
  if (appearance.translucent) root.removeAttribute('data-translucent')
  else root.setAttribute('data-translucent', 'off')
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
