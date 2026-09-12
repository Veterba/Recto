import type { CommandRegistry } from './commands'
import { listViews } from './view-registry'
import type { Workspace } from './workspace'

/**
 * The app's command set, declared as data.
 *
 * Adding a shortcut means adding an entry here - not a keydown handler in a
 * component. That is what keeps the palette, the menus and the hotkey editor
 * showing the same truth.
 */

export type CommandContext = {
  workspace: Workspace
  openPalette: () => void
  closeVault: () => void
}

export function registerAppCommands(registry: CommandRegistry, ctx: CommandContext): () => void {
  const { workspace } = ctx
  const hasActiveLeaf = (): boolean => workspace.activeLeaf !== null

  const offs: (() => void)[] = []

  offs.push(
    registry.register({
      id: 'app:command-palette',
      name: 'Open command palette',
      section: 'App',
      hotkey: 'Mod+P',
      run: ctx.openPalette,
    }),
    registry.register({
      id: 'vault:close',
      name: 'Close vault',
      section: 'Vault',
      run: ctx.closeVault,
    }),
    registry.register({
      id: 'workspace:close-tab',
      name: 'Close current tab',
      section: 'Workspace',
      hotkey: 'Mod+W',
      isAvailable: hasActiveLeaf,
      run: () => {
        const leaf = workspace.activeLeaf
        if (leaf) workspace.closeLeaf(leaf.id)
      },
    }),
    registry.register({
      id: 'workspace:split-right',
      name: 'Split pane right',
      section: 'Workspace',
      hotkey: 'Mod+Alt+ArrowRight',
      isAvailable: hasActiveLeaf,
      run: () => {
        const leaf = workspace.activeLeaf
        if (leaf) workspace.splitLeaf(leaf.id, 'vertical')
      },
    }),
    registry.register({
      id: 'workspace:split-down',
      name: 'Split pane down',
      section: 'Workspace',
      hotkey: 'Mod+Alt+ArrowDown',
      isAvailable: hasActiveLeaf,
      run: () => {
        const leaf = workspace.activeLeaf
        if (leaf) workspace.splitLeaf(leaf.id, 'horizontal')
      },
    }),
    registry.register({
      id: 'workspace:next-tab',
      name: 'Go to next tab',
      section: 'Workspace',
      hotkey: 'Ctrl+Tab',
      isAvailable: hasActiveLeaf,
      run: () => cycleTab(workspace, 1),
    }),
    registry.register({
      id: 'workspace:previous-tab',
      name: 'Go to previous tab',
      section: 'Workspace',
      hotkey: 'Ctrl+Shift+Tab',
      isAvailable: hasActiveLeaf,
      run: () => cycleTab(workspace, -1),
    }),
  )

  // One "open X" command per registered view, generated rather than listed, so a
  // new view type is reachable from the palette the moment it registers.
  for (const view of listViews()) {
    offs.push(
      registry.register({
        id: `workspace:open-${view.type}`,
        name: `Open ${view.title}`,
        section: 'Open',
        run: () => {
          workspace.openView(view.type)
        },
      }),
    )
  }

  return () => offs.forEach((off) => off())
}

function cycleTab(workspace: Workspace, delta: number): void {
  const leaf = workspace.activeLeaf
  if (!leaf) return
  const tabs = workspace.tabsContaining(leaf.id)
  if (!tabs || tabs.children.length < 2) return
  const next = (tabs.active + delta + tabs.children.length) % tabs.children.length
  workspace.setActiveTab(tabs.id, next)
}
