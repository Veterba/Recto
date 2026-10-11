import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../../../src/renderer/app/commands'
import { formatChord, normalizeChord, RESERVED } from '../../../src/renderer/app/hotkeys'
import { groupRows, rowMatches, SECTION_ORDER, type HotkeyRow } from '../../../src/renderer/app/hotkey-groups'
import { registerAppCommands, type CommandContext } from '../../../src/renderer/app/register-commands'
import { registerEditorCommands } from '../../../src/renderer/features/editor/editor-commands'
import { Workspace } from '../../../src/renderer/app/workspace'

/** Every app and editor command, registered as the shell does. */
function allCommands(): CommandRegistry {
  const registry = new CommandRegistry()
  registerEditorCommands(registry, () => {})
  const noop = (): void => {}
  const ctx = new Proxy({ workspace: new Workspace() } as Partial<CommandContext>, {
    get: (target, key) => (key in target ? target[key as keyof CommandContext] : noop),
  }) as CommandContext
  registerAppCommands(registry, ctx)
  return registry
}

describe('default hotkeys', () => {
  const registry = allCommands()
  const bound = registry.list().filter((c) => c.hotkey !== undefined)

  it('no default is a chord macOS or the standard menu keeps', () => {
    const clashes = bound.filter((c) => RESERVED[normalizeChord(c.hotkey!)] !== undefined).map((c) => `${c.id} ${c.hotkey}`)
    expect(clashes).toEqual([])
  })

  it('no two defaults clash in one scope', () => {
    expect(registry.conflicts()).toEqual([])
  })

  it('the ones asked for', () => {
    const key = (id: string): string | null => registry.bindingFor(id)
    expect(key('editor:insert-table')).toBe('Mod+Alt+T')
    expect(key('editor:template')).toBe('Mod+Shift+T')
    expect(key('table:move-row-up')).toBe('Alt+ArrowUp')
    expect(key('table:move-row-down')).toBe('Alt+ArrowDown')
    expect(key('table:move-column-left')).toBe('Alt+ArrowLeft')
    expect(key('table:move-column-right')).toBe('Alt+ArrowRight')
    expect(key('table:add-row-below')).toBe('Mod+Enter')
    expect(key('app:shortcuts')).toBe('Mod+/')
    expect(key('editor:highlight')).toBe('Mod+Shift+H')
    expect(key('editor:highlight-picker')).toBe('Mod+Alt+H')
    expect(key('app:home')).toBe('Ctrl+Mod+H')
  })

  it('Obsidian defaults where Obsidian has one', () => {
    const obsidian: Record<string, string> = {
      'vault:new-note': 'Mod+N',
      'search:quick-switcher': 'Mod+O',
      'app:command-palette': 'Mod+P',
      'search:open': 'Mod+Shift+F',
      'app:settings': 'Mod+,',
      'workspace:close-tab': 'Mod+W',
      'editor:bold': 'Mod+B',
      'editor:italic': 'Mod+I',
      'editor:link': 'Mod+K',
      'editor:checklist': 'Mod+L',
      'editor:find': 'Mod+F',
      'editor:replace': 'Mod+Alt+F',
      'graph:toggle': 'Mod+G',
    }
    for (const [id, binding] of Object.entries(obsidian)) expect([id, registry.bindingFor(id)]).toEqual([id, binding])
  })

  it('every command is in a named group', () => {
    const groups = new Set(registry.list().map((c) => c.section))
    for (const group of groups) expect(SECTION_ORDER as readonly (string | undefined)[]).toContain(group)
  })
})

describe('key names', () => {
  it('a binding that spells a key out matches the key pressed (Mod+Shift+Minus used to never fire)', () => {
    expect(normalizeChord('Mod+Shift+Minus', true)).toBe('shift+meta+-')
    expect(normalizeChord('Mod+Slash', true)).toBe(normalizeChord('Mod+/', true))
    expect(formatChord('Mod+Enter', true)).toBe('⌘↵')
  })
})

describe('grouping and search', () => {
  const row = (id: string, name: string, section: string, label: string | null = null): HotkeyRow => ({
    id,
    name,
    section,
    scope: 'app',
    binding: null,
    label,
  })

  it('groups in the fixed order, names sorted', () => {
    const groups = groupRows([
      row('b', 'Zoom', 'Panes'),
      row('a', 'Bold', 'Formatting'),
      row('c', 'Align', 'Formatting'),
      row('d', 'X', 'Zzz'),
    ])
    expect(groups.map((g) => g.section)).toEqual(['Formatting', 'Panes', 'Zzz'])
    expect(groups[0]!.rows.map((r) => r.name)).toEqual(['Align', 'Bold'])
  })

  it('finds by name, group or keys', () => {
    const bold = row('editor:bold', 'Bold', 'Formatting', '⌘B')
    expect(rowMatches(bold, 'bol')).toBe(true)
    expect(rowMatches(bold, 'format')).toBe(true)
    expect(rowMatches(bold, '⌘b')).toBe(true)
    expect(rowMatches(bold, 'italic')).toBe(false)
  })
})
