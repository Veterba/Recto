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
  /** chord -> command id. Rebuilt on any change; lookup must be O(1). */
  private chords = new Map<Chord, string>()
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
   */
  handleKeyEvent(ev: KeyboardEvent): boolean {
    const id = this.chords.get(chordFromEvent(ev))
    if (id === undefined) return false
    const command = this.commands.get(id)
    if (!command || !(command.isAvailable?.() ?? true)) return false
    void this.run(id)
    return true
  }

  private reindex(): void {
    this.chords.clear()
    for (const command of this.commands.values()) {
      const binding = this.bindingFor(command.id)
      if (binding === null) continue
      // Last registration wins; a real conflict is a bug we want visible in the
      // hotkey editor rather than silently swallowed here.
      this.chords.set(normalizeChord(binding), command.id)
    }
    this.trigger('change')
  }
}

export const commands = new CommandRegistry()
