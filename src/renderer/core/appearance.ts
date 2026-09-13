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
  /** Hue only: saturation and lightness stay fixed so every accent stays legible. */
  accentHue: number
  sidebarWidth: number
  sidebarOpen: boolean
  /** Live Preview hides markdown markers away from the cursor. */
  livePreview: boolean
  /** Editor font size in px. */
  fontSize: number
  /** Monospace suits markdown source; serif/sans suit long-form reading. */
  editorFont: 'mono' | 'sans' | 'serif'
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  accentHue: 258,
  sidebarWidth: 260,
  sidebarOpen: true,
  livePreview: true,
  fontSize: 14,
  editorFont: 'mono',
}

/** Apply to the document. Theme is an attribute; accent is a variable override. */
const FONT_STACKS: Record<Appearance['editorFont'], string> = {
  mono: 'var(--font-mono)',
  sans: 'var(--font-ui)',
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Palatino Linotype", serif',
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance.theme)
  root.style.setProperty('--accent-h', String(appearance.accentHue))
  // The editor reads these two through the theme, so changing them repaints it
  // without the editor being rebuilt.
  root.style.setProperty('--editor-font-size', `${appearance.fontSize}px`)
  root.style.setProperty('--font-editor', FONT_STACKS[appearance.editorFont])
}

function coerce(value: unknown): Appearance {
  if (typeof value !== 'object' || value === null) return DEFAULT_APPEARANCE
  const v = value as Partial<Appearance>
  const theme: Theme = v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : DEFAULT_APPEARANCE.theme
  return {
    theme,
    accentHue: typeof v.accentHue === 'number' && v.accentHue >= 0 && v.accentHue < 360 ? v.accentHue : DEFAULT_APPEARANCE.accentHue,
    sidebarWidth: typeof v.sidebarWidth === 'number' ? Math.min(520, Math.max(180, v.sidebarWidth)) : DEFAULT_APPEARANCE.sidebarWidth,
    sidebarOpen: typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : DEFAULT_APPEARANCE.sidebarOpen,
    livePreview: typeof v.livePreview === 'boolean' ? v.livePreview : DEFAULT_APPEARANCE.livePreview,
    fontSize:
      typeof v.fontSize === 'number' && v.fontSize >= 11 && v.fontSize <= 24
        ? v.fontSize
        : DEFAULT_APPEARANCE.fontSize,
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
