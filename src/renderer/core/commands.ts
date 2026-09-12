import { Events } from './events'
import { chordFromEvent, normalizeChord, type Chord } from './hotkeys'

/**
 * The command registry.
 *
 * Everything reads it: the palette, the menu bar, context menus, and later the
 * settings hotkey editor. A shortcut is a field on a command, not a `keydown`
 * handler in some component - which is the only way conflicting bindings stay
 * discoverable instead of mysterious.
 */

export type Command = {
  id: string
  name: string
  /** Grouping label in the palette, e.g. 'Editor', 'Vault'. */
  section?: string
  /** Lucide icon name, shown in the palette. */
  icon?: string
  /**
   * Where the binding applies. An `editor` command wins its chord whenever the
   * editor has focus, which is how `⌘B` can mean bold in a note and "toggle
   * sidebar" everywhere else.
   */
  scope?: 'app' | 'editor'
  /** Default binding, e.g. 'Mod+Shift+1'. Overridable via hotkeys.json. */
  hotkey?: string
  /**
   * Whether the command applies right now. Unavailable commands are hidden from
   * the palette and their hotkey falls through. Default: always available.
   */
  isAvailable?: () => boolean
  run: () => void | Promise<void>
}

type RegistryEvents = {
  change: readonly []
  ran: readonly [id: string]
}

export class CommandRegistry extends Events<RegistryEvents> {
  private commands = new Map<string, Command>()
  /**
   * chord -> command ids, editor-scoped first.
   *
   * A list rather than a single id: two commands genuinely may share a chord
   * (bold in the editor, toggle-sidebar elsewhere). An earlier version stored
   * one id and silently let the last registration win, which made ⌘B collapse
   * the sidebar while you were typing.
   */
  private chords = new Map<Chord, string[]>()
  /** User overrides from hotkeys.json: command id -> binding (or null to unbind). */
  private overrides = new Map<string, string | null>()

  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`duplicate command id: ${command.id}`)
    }
    this.commands.set(command.id, command)
    this.reindex()
    return () => {
      this.commands.delete(command.id)
      this.reindex()
    }
  }

  registerAll(commands: readonly Command[]): () => void {
    const undo = commands.map((c) => this.register(c))
    return () => undo.forEach((fn) => fn())
  }

  /** Replace all user overrides at once (i.e. when hotkeys.json loads). */
  setOverrides(overrides: Readonly<Record<string, string | null>>): void {
    this.overrides = new Map(Object.entries(overrides))
    this.reindex()
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  /** The binding in force for a command: user override, else its default. */
  bindingFor(id: string): string | null {
    const override = this.overrides.get(id)
    if (override !== undefined) return override
    return this.commands.get(id)?.hotkey ?? null
  }

  list(): Command[] {
    return [...this.commands.values()]
  }

  available(): Command[] {
    return this.list().filter((c) => c.isAvailable?.() ?? true)
  }

  async run(id: string): Promise<boolean> {
    const command = this.commands.get(id)
    if (!command) return false
    if (!(command.isAvailable?.() ?? true)) return false
    await command.run()
    this.trigger('ran', id)
    return true
  }

  /**
   * Dispatch a keyboard event. Returns true if a command handled it, so the
   * caller knows whether to preventDefault.
   *
   * Candidates are tried in order - editor scope first - and the first
   * available one wins. So a chord shared between an editor command and an app
   * command resolves by context rather than by registration order.
   */
  handleKeyEvent(ev: KeyboardEvent): boolean {
    const ids = this.chords.get(chordFromEvent(ev))
    if (ids === undefined) return false
    for (const id of ids) {
      const command = this.commands.get(id)
      if (!command || !(command.isAvailable?.() ?? true)) continue
      void this.run(id)
      return true
    }
    return false
  }

  /** Every command bound to a chord, for a hotkey editor to show conflicts. */
  conflicts(): { chord: Chord; ids: string[] }[] {
    return [...this.chords.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([chord, ids]) => ({ chord, ids }))
  }

  private reindex(): void {
    this.chords.clear()
    for (const command of this.commands.values()) {
      const binding = this.bindingFor(command.id)
      if (binding === null) continue
      const chord = normalizeChord(binding)
      const list = this.chords.get(chord) ?? []
      // Editor-scoped first, so it gets the chord when a note has focus.
      if (command.scope === 'editor') list.unshift(command.id)
      else list.push(command.id)
      this.chords.set(chord, list)
    }
    this.trigger('change')
  }
}

export const commands = new CommandRegistry()
