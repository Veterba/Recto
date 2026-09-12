import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../src/renderer/core/commands'
import { chordFromEvent, formatChord, normalizeChord } from '../src/renderer/core/hotkeys'
import { fuzzyFilter, fuzzyMatch, toSegments } from '../src/renderer/core/fuzzy'

/** A KeyboardEvent stand-in; jsdom is not needed for chord logic. */
function key(init: Partial<KeyboardEvent> & { key: string; code?: string }): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent
}

describe('hotkey chords', () => {
  it('Mod maps to Cmd on mac and Ctrl elsewhere', () => {
    expect(normalizeChord('Mod+P', true)).toBe('meta+p')
    expect(normalizeChord('Mod+P', false)).toBe('ctrl+p')
  })

  it('modifier order does not matter', () => {
    expect(normalizeChord('Shift+Mod+P', true)).toBe(normalizeChord('Mod+Shift+P', true))
    expect(normalizeChord('Alt+Ctrl+K', true)).toBe('ctrl+alt+k')
  })

  it('reads digits from code, so Mod+Shift+1 is not "!"', () => {
    // Shift+1 gives key="!" on a US layout. Using ev.key would break the binding.
    expect(chordFromEvent(key({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }))).toBe('shift+meta+1')
    expect(normalizeChord('Mod+Shift+1', true)).toBe('shift+meta+1')
  })

  it('reads letters from code, so layout does not change the binding', () => {
    expect(chordFromEvent(key({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true }))).toBe('shift+meta+p')
  })

  it('formats for display', () => {
    expect(formatChord('Mod+Shift+P', true)).toBe('⇧⌘P')
    expect(formatChord('Mod+Shift+P', false)).toBe('Ctrl+Shift+P')
    expect(formatChord('Mod+Enter', true)).toBe('⌘↵')
    // Named keys must not render lowercase ('^tab' looked like a typo in the UI).
    expect(formatChord('Ctrl+Tab', true)).toBe('⌃Tab')
    expect(formatChord('Ctrl+Shift+Tab', true)).toBe('⌃⇧Tab')
  })
})

describe('CommandRegistry', () => {
  const make = (): CommandRegistry => new CommandRegistry()

  it('dispatches a matching chord and reports that it handled it', async () => {
    const reg = make()
    const run = vi.fn()
    reg.register({ id: 'a', name: 'A', hotkey: 'Mod+K', run })
    const handled = reg.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true }))
    expect(handled).toBe(true)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it('ignores a chord with no command, so the key event falls through', () => {
    const reg = make()
    reg.register({ id: 'a', name: 'A', hotkey: 'Mod+K', run: vi.fn() })
    expect(reg.handleKeyEvent(key({ key: 'j', code: 'KeyJ', metaKey: true }))).toBe(false)
  })

  it('skips unavailable commands in dispatch, run and the palette list', async () => {
    const reg = make()
    const run = vi.fn()
    reg.register({ id: 'a', name: 'A', hotkey: 'Mod+K', isAvailable: () => false, run })
    expect(reg.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(false)
    expect(await reg.run('a')).toBe(false)
    expect(reg.available()).toHaveLength(0)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses duplicate ids rather than silently shadowing', () => {
    const reg = make()
    reg.register({ id: 'a', name: 'A', run: vi.fn() })
    expect(() => reg.register({ id: 'a', name: 'A again', run: vi.fn() })).toThrow(/duplicate/)
  })

  it('unregister removes the command and frees its chord', () => {
    const reg = make()
    const off = reg.register({ id: 'a', name: 'A', hotkey: 'Mod+K', run: vi.fn() })
    off()
    expect(reg.get('a')).toBeUndefined()
    expect(reg.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(false)
  })

  it('a user override rebinds, and null unbinds', async () => {
    const reg = make()
    const run = vi.fn()
    reg.register({ id: 'a', name: 'A', hotkey: 'Mod+K', run })
    reg.setOverrides({ a: 'Mod+J' })
    expect(reg.handleKeyEvent(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(false)
    expect(reg.handleKeyEvent(key({ key: 'j', code: 'KeyJ', metaKey: true }))).toBe(true)
    expect(reg.bindingFor('a')).toBe('Mod+J')

    reg.setOverrides({ a: null })
    expect(reg.handleKeyEvent(key({ key: 'j', code: 'KeyJ', metaKey: true }))).toBe(false)
    expect(reg.bindingFor('a')).toBeNull()
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it('run() still works for a command with no hotkey at all', async () => {
    const reg = make()
    const run = vi.fn()
    reg.register({ id: 'a', name: 'A', run })
    expect(await reg.run('a')).toBe(true)
    expect(await reg.run('nope')).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('fuzzy matching', () => {
  it('matches subsequences and rejects non-subsequences', () => {
    expect(fuzzyMatch('vc', 'vault:close')).not.toBeNull()
    expect(fuzzyMatch('zzz', 'vault:close')).toBeNull()
  })

  it('an empty query matches everything with no highlight', () => {
    const m = fuzzyMatch('', 'anything')
    expect(m).toEqual({ score: 0, ranges: [] })
  })

  it('is case-insensitive but reports ranges into the original text', () => {
    const m = fuzzyMatch('cp', 'Command Palette')
    expect(m).not.toBeNull()
    expect(toSegments('Command Palette', m!.ranges).filter((s) => s.hit).map((s) => s.text)).toEqual(['C', 'P'])
  })

  it('collapses adjacent hits into one range so the DOM stays small', () => {
    const m = fuzzyMatch('com', 'command')
    expect(m?.ranges).toEqual([[0, 3]])
  })

  it('ranks word-boundary matches above mid-word ones', () => {
    const ranked = fuzzyFilter('vc', ['vault:close', 'advanced-canvas'], (s) => s)
    expect(ranked[0]?.item).toBe('vault:close')
  })

  it('ranks consecutive runs above scattered hits', () => {
    // Same length, same leading boundary - the only difference is adjacency.
    const ranked = fuzzyFilter('ab', ['abx', 'axb'], (s) => s)
    expect(ranked[0]?.item).toBe('abx')
  })

  it('scores initials highly, because that is how people drive a palette', () => {
    // Typing "cp" for "Command Palette" is the dominant idiom, so a match on
    // word-start characters must beat a longer incidental substring match.
    const ranked = fuzzyFilter('cp', ['Command Palette', 'Close pane', 'copy'], (s) => s)
    expect(ranked.map((r) => r.item).slice(0, 2)).toContain('Command Palette')
  })

  it('toSegments reconstructs the original string exactly', () => {
    const text = 'Split pane vertically'
    const m = fuzzyMatch('spv', text)!
    expect(toSegments(text, m.ranges).map((s) => s.text).join('')).toBe(text)
  })
})

describe('shifted punctuation bindings', () => {
  it('resolves punctuation through ev.code, so Shift does not break the binding', () => {
    // Shift+] reports key='}'. Matching on ev.key would make the binding dead.
    expect(chordFromEvent(key({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }))).toBe('shift+meta+]')
    expect(normalizeChord('Mod+Shift+]', true)).toBe('shift+meta+]')
    expect(chordFromEvent(key({ key: '<', code: 'Comma', shiftKey: true, ctrlKey: true }))).toBe('ctrl+shift+,')
  })

  it('Tab is shift-stable, which is why tab cycling uses it', () => {
    expect(chordFromEvent(key({ key: 'Tab', code: 'Tab', ctrlKey: true }))).toBe('ctrl+tab')
    expect(chordFromEvent(key({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+tab')
    expect(normalizeChord('Ctrl+Shift+Tab', true)).toBe('ctrl+shift+tab')
  })
})
