import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { isAiModel, type AiModelId, type VibrancyMaterial } from '@shared/ipc-contract'
import { coerceSidebarTheme, grainLevels, NO_THEME, tintCss, type SidebarTheme } from './sidebar-theme'

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
  /** The note's name, editable, centred above its text. */
  showNoteTitle: boolean
  /**
   * How big the sidebar's own text and rows are, as a multiplier.
   *
   * Separate from the editor's font size on purpose: the sidebar is a list you
   * scan, the editor is prose you read, and the size that suits one is rarely
   * the size that suits the other.
   */
  sidebarScale: number
  /** Heavier sidebar text. A frosted panel eats stroke weight. */
  sidebarBold: boolean
  /** How white the sidebar's text is, 0-100. */
  sidebarContrast: number
  /** Seconds the pointer rests on a note before its preview card opens. */
  previewDelay: number
  /**
   * The sidebar's own colour: a gradient laid OVER the frosted panel.
   *
   * A tint rather than a replacement, which is what makes it safe to let anyone
   * pick any colour - the text colours, the blur and the backdrop still come
   * from the theme, so the worst outcome is a green sidebar rather than an
   * unreadable one.
   */
  sidebarTheme: SidebarTheme
  /**
   * Which model new messages go to.
   *
   * Here rather than per conversation because it is a preference, not a
   * property of a chat - though a conversation records the model it was last
   * answered by, so reopening an old one picks its model back up.
   */
  aiModel: AiModelId
  /**
   * macOS vibrancy: the desktop, blurred, through the sidebar.
   *
   * One switch and nothing else. It used to carry a transparency slider and a
   * soft/medium/strong blur picker, and they were the wrong shape for the
   * problem: how transparent the sidebar can be before it stops reading is not
   * a matter of taste, it depends on whether the panel is dark-on-light or
   * light-on-dark - which is the theme. So the theme decides, and the switch
   * is what is left for the user, because vibrancy over a busy wallpaper is
   * genuinely divisive.
   */
  translucent: boolean
}

/**
 * Bounds for the hover-preview delay, in seconds.
 *
 * The floor is not zero: under half a second, every trip of the pointer across
 * the sidebar opens a card, which is the flicker the delay exists to prevent.
 */
export const PREVIEW_DELAY_MIN = 0.5
export const PREVIEW_DELAY_MAX = 5

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
  showNoteTitle: true,
  sidebarScale: 1.05,
  sidebarBold: true,
  sidebarContrast: 70,
  previewDelay: 2,
  sidebarTheme: NO_THEME,
  aiModel: 'claude-sonnet-5',
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

/**
 * Vibrancy is macOS-only, and without it a translucent window is just an
 * unreadable one - the desktop would show through raw and unblurred. Checked
 * from the user agent rather than over IPC so it is available synchronously,
 * before the first paint.
 */
const SUPPORTS_VIBRANCY = /Mac OS X/.test(navigator.userAgent)

/**
 * Which macOS material blurs the backdrop, per theme.
 *
 * The light theme's sidebar is a dark panel over a bright page and can afford
 * to be almost entirely backdrop - soft, so the shapes behind it survive and
 * the panel reads as glass. The dark theme's is a light panel over a dark page
 * and needs the backdrop quieter to keep its own edge, so it blurs one step
 * further. How transparent each one goes is `--sidebar-t` in the stylesheet,
 * next to the `--sidebar-fade` it multiplies.
 */
const MATERIAL: Record<'light' | 'dark', VibrancyMaterial> = {
  light: 'fullscreen-ui',
  dark: 'sidebar',
}

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

/** What `system` actually resolves to right now. */
export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return darkQuery().matches ? 'dark' : 'light'
}

/**
 * The material and the window appearance currently pushed, so a re-apply that
 * changes nothing - and every sidebar-width drag calls one - does not cross
 * the bridge.
 */
let material: VibrancyMaterial | null | undefined
let themeSource: Theme | undefined

/**
 * The tree row height, in px, at the current sidebar scale.
 *
 * The file tree is virtualised, so it has to agree with the CSS about how tall
 * a row is - a number in a stylesheet and a different number in the layout
 * maths is a tree that scrolls to the wrong place.
 */
const BASE_ROW_HEIGHT = 24
let rowHeightPx = BASE_ROW_HEIGHT
export const treeRowHeight = (): number => rowHeightPx

/**
 * Full screen switches the translucency off for as long as it lasts.
 *
 * There is no desktop behind a full-screen window - macOS puts a black space
 * there - so a translucent sidebar stops being translucent and becomes a
 * lower-contrast one. Not a setting: the user did not ask for this, the window
 * did.
 */
let fullScreen = false
let applied: Appearance | null = null

export function setFullScreen(on: boolean): void {
  if (fullScreen === on) return
  fullScreen = on
  if (applied !== null) applyAppearance(applied)
}

export function applyAppearance(appearance: Appearance): void {
  applied = appearance
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

  // Sidebar legibility. Three knobs because the three complaints were separate:
  // too small, too light in weight, and too grey against a busy backdrop.
  const scale = Math.min(1.25, Math.max(0.9, appearance.sidebarScale))
  rowHeightPx = Math.round(BASE_ROW_HEIGHT * scale)
  root.style.setProperty('--sidebar-scale', scale.toFixed(2))
  root.style.setProperty('--tree-row-h', `${rowHeightPx}px`)
  root.style.setProperty('--sidebar-weight', appearance.sidebarBold ? '540' : '440')
  // Never below 0.80: the floor is what stops a contrast slider from being a
  // way to make the sidebar unreadable.
  const ink = 0.8 + (Math.min(100, Math.max(0, appearance.sidebarContrast)) / 100) * 0.2
  root.style.setProperty('--sidebar-ink-alpha', ink.toFixed(3))
  root.style.setProperty('--sidebar-dim-alpha', (ink - 0.26).toFixed(3))
  // A `background-image` over the panel's `background-color`, so it tints the
  // frost rather than replacing it.
  root.style.setProperty('--sidebar-tint', tintCss(appearance.sidebarTheme))
  const grain = grainLevels(appearance.sidebarTheme.grain)
  root.style.setProperty('--grain-amount', grain.amount.toFixed(2))
  root.style.setProperty('--grain-boost', grain.boost.toFixed(2))
  // One attribute swaps every translucent token for its opaque equivalent.
  /**
   * The window's own macOS appearance has to follow the app's theme.
   *
   * AppKit draws a light and a dark variant of every vibrancy material and
   * picks by the window's appearance, which by default is the OS's. So on a
   * Mac in dark mode, choosing the app's Light theme left the sidebar wearing
   * DARK vibrancy - a dark blur that no tint of ours could lighten. Measured:
   * the same sidebar over the same desktop reads 103 with the window dark and
   * 164 with it light. Two rounds of "make it lighter" were spent on the tint,
   * which was never the thing that was dark.
   */
  if (themeSource !== appearance.theme) {
    themeSource = appearance.theme
    void api.invoke('app:set-theme-source', appearance.theme)
  }

  const wanted =
    appearance.translucent && SUPPORTS_VIBRANCY && !fullScreen
      ? MATERIAL[resolvedTheme(appearance.theme)]
      : null
  if (material !== wanted) {
    material = wanted
    void api.invoke('app:set-vibrancy', wanted)
  }

  if (appearance.translucent && SUPPORTS_VIBRANCY && !fullScreen) {
    root.removeAttribute('data-translucent')
    // How far the sidebar fades, and how much grain sits over it, are both in
    // the stylesheet - `--sidebar-t` and `--grain-opacity`, set per theme next
    // to the `--sidebar-fade` they are multiplied by. Nothing to set here.
  } else {
    root.setAttribute('data-translucent', 'off')
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
    showNoteTitle: typeof v.showNoteTitle === 'boolean' ? v.showNoteTitle : DEFAULT_APPEARANCE.showNoteTitle,
    sidebarScale:
      typeof v.sidebarScale === 'number' && Number.isFinite(v.sidebarScale)
        ? Math.min(1.25, Math.max(0.9, v.sidebarScale))
        : DEFAULT_APPEARANCE.sidebarScale,
    sidebarBold: typeof v.sidebarBold === 'boolean' ? v.sidebarBold : DEFAULT_APPEARANCE.sidebarBold,
    sidebarContrast:
      typeof v.sidebarContrast === 'number' && Number.isFinite(v.sidebarContrast)
        ? Math.min(100, Math.max(0, v.sidebarContrast))
        : DEFAULT_APPEARANCE.sidebarContrast,
    sidebarTheme: coerceSidebarTheme(v.sidebarTheme),
    previewDelay:
      typeof v.previewDelay === 'number' && Number.isFinite(v.previewDelay)
        ? Math.min(PREVIEW_DELAY_MAX, Math.max(PREVIEW_DELAY_MIN, v.previewDelay))
        : DEFAULT_APPEARANCE.previewDelay,
    aiModel: isAiModel(v.aiModel) ? v.aiModel : DEFAULT_APPEARANCE.aiModel,
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
    // Full screen is pushed from main, and asked for once in case the window
    // was already full screen when the renderer loaded.
    void api.invoke('app:is-fullscreen').then((on) => {
      if (!cancelled) setFullScreen(on)
    })
    const off = api.on('app:fullscreen', (on) => setFullScreen(on))

    // On `system`, the OS switching theme changes which vibrancy material the
    // window should wear. CSS handles its own side through
    // `prefers-color-scheme`; the material is a window property and has to be
    // pushed.
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (): void => {
      setAppearance((current) => {
        if (current.theme === 'system') applyAppearance(current)
        return current
      })
    }
    query.addEventListener('change', onScheme)

    return () => {
      cancelled = true
      off()
      query.removeEventListener('change', onScheme)
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
