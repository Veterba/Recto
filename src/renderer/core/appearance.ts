import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * Appearance and shell layout, persisted to `.obsidian-like/appearance.json`.
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
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'system',
  accentHue: 258,
  sidebarWidth: 260,
  sidebarOpen: true,
}

/** Apply to the document. Theme is an attribute; accent is a variable override. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance.theme)
  root.style.setProperty('--accent-h', String(appearance.accentHue))
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
