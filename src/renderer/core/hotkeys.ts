/**
 * Hotkey parsing and normalisation.
 *
 * Bindings are written once, as data: `'Mod+Shift+1'`. `Mod` is Cmd on macOS and
 * Ctrl elsewhere, so a binding never has to be declared twice. A chord is
 * normalised to a canonical string so that lookup is a Map hit, not a scan.
 */

export type Chord = string

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Exported for tests; production reads the platform. */
export function normalizeChord(binding: string, isMac = IS_MAC): Chord {
  const parts = binding
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const mods = new Set<string>()
  let key = ''

  for (const raw of parts) {
    const p = raw.toLowerCase()
    switch (p) {
      case 'mod':
        mods.add(isMac ? 'meta' : 'ctrl')
        break
      case 'cmd':
      case 'meta':
      case 'super':
        mods.add('meta')
        break
      case 'ctrl':
      case 'control':
        mods.add('ctrl')
        break
      case 'alt':
      case 'option':
        mods.add('alt')
        break
      case 'shift':
        mods.add('shift')
        break
      default:
        key = p
    }
  }

  // Fixed modifier order so 'Shift+Mod+P' and 'Mod+Shift+P' are the same chord.
  const order = ['ctrl', 'alt', 'shift', 'meta'].filter((m) => mods.has(m))
  return [...order, key].join('+')
}

/** The chord a keyboard event represents, in the same canonical form. */
export function chordFromEvent(ev: KeyboardEvent): Chord {
  const mods: string[] = []
  if (ev.ctrlKey) mods.push('ctrl')
  if (ev.altKey) mods.push('alt')
  if (ev.shiftKey) mods.push('shift')
  if (ev.metaKey) mods.push('meta')

  // `ev.key` is layout- and shift-dependent ('!' for Shift+1, '}' for Shift+]);
  // `ev.code` is not. Resolve through the physical key so that a binding written
  // as 'Mod+Shift+1' or 'Mod+Shift+]' matches what the user actually pressed.
  let key = ev.key.toLowerCase()
  const digit = /^Digit(\d)$/.exec(ev.code)
  const letter = /^Key([A-Z])$/.exec(ev.code)
  const punct = PUNCTUATION_BY_CODE[ev.code]
  if (digit?.[1] !== undefined) key = digit[1]
  else if (letter?.[1] !== undefined) key = letter[1].toLowerCase()
  else if (punct !== undefined) key = punct

  return [...mods, key].join('+')
}

/**
 * Punctuation whose `ev.key` changes under Shift. Without this, a binding like
 * 'Mod+Shift+]' never fires, because the event reports '}'.
 */
const PUNCTUATION_BY_CODE: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
}

/** Human-readable form for menus and the palette. */
export function formatChord(binding: string, isMac = IS_MAC): string {
  const chord = normalizeChord(binding, isMac)
  const parts = chord.split('+')
  const key = parts.pop() ?? ''
  const glyph: Record<string, string> = isMac
    ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
    : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }
  const keyLabel: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    enter: '↵',
    escape: 'Esc',
    ' ': 'Space',
    space: 'Space',
    backspace: '⌫',
    delete: '⌦',
    tab: 'Tab',
  }
  const label =
    keyLabel[key] ??
    (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))
  const mods = parts.map((m) => glyph[m] ?? m)
  return isMac ? [...mods, label].join('') : [...mods, label].join('+')
}
