import { useCallback, useEffect, useMemo, useState } from 'react'
import type { VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { CommandPalette } from '../components/CommandPalette'
import { FileTree } from '../components/FileTree'
import { Icon } from '../components/Icon'
import { Rail } from '../components/Rail'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { WorkspaceView } from '../components/WorkspaceView'
import { useAppearance, type Theme } from '../core/appearance'
import { commands } from '../core/commands'
import { registerAppCommands } from '../core/register-commands'
import { getSection, sectionForViewType, type Section, type SectionId } from '../core/sections'
import { useVault } from '../core/vault-store'
import { useWorkspace } from '../core/use-workspace'
import { registerMarkdownView } from './MarkdownView'
import { registerStubViews } from './stubs'

type Props = {
  vault: VaultInfo
  onCloseVault: () => void
}

// Views register once per module load, before any layout is restored - otherwise
// a saved leaf would resolve to "unknown" on first paint.
registerStubViews()
registerMarkdownView()

const THEME_CYCLE: readonly Theme[] = ['system', 'light', 'dark']

export function VaultShell({ vault, onCloseVault }: Props): React.ReactElement {
  const { workspace, revision } = useWorkspace()
  const { appearance, ready, update } = useAppearance()
  const { tree, refresh } = useVault(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const openPalette = useCallback(() => setPaletteOpen(true), [])

  // Derived from the open tab, so the rail can never contradict the content.
  // `revision` is in the deps because Workspace mutates in place.
  const activeSection = useMemo(() => {
    const leaf = workspace?.activeLeaf
    const fromLeaf = leaf ? sectionForViewType(leaf.type) : undefined
    return fromLeaf ?? getSection('data')!
  }, [workspace, revision])

  const toggleSidebar = useCallback(() => {
    update({ sidebarOpen: !appearance.sidebarOpen })
  }, [appearance.sidebarOpen, update])

  const goToSection = useCallback(
    (id: SectionId) => {
      const section = getSection(id)
      if (!section || !workspace) return
      // Re-selecting the current section collapses its panel; selecting a new
      // one always reveals it. Matches every editor that has a rail.
      const sameSection = id === activeSection.id
      if (section.noPanel !== true) {
        // Re-selecting the section you are already in collapses its panel;
        // moving to a new section always reveals it.
        update({ sidebarOpen: sameSection ? !appearance.sidebarOpen : true })
      }
      workspace.openView(section.viewType)
    },
    [workspace, activeSection.id, appearance.sidebarOpen, update],
  )

  const cycleTheme = useCallback(() => {
    const at = THEME_CYCLE.indexOf(appearance.theme)
    update({ theme: THEME_CYCLE[(at + 1) % THEME_CYCLE.length] ?? 'system' })
  }, [appearance.theme, update])

  const onRailSelect = useCallback((section: Section) => goToSection(section.id), [goToSection])

  const activePath = useMemo(() => {
    const state = workspace?.activeLeaf?.state
    const path = state?.['path']
    return typeof path === 'string' ? path : null
  }, [workspace, revision])

  const openFile = useCallback(
    (path: string) => {
      workspace?.openView('markdown', { path })
    },
    [workspace],
  )

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  /**
   * New items land next to whatever is selected: inside the active folder, or
   * alongside the open note. Creating at the root when you are three folders
   * deep is the behaviour everyone complains about.
   */
  const createIn = useCallback(
    async (kind: 'file' | 'folder') => {
      const parent = activePath === null ? '' : activePath.slice(0, Math.max(0, activePath.lastIndexOf('/')))
      const name = kind === 'file' ? 'Untitled.md' : 'New folder'
      const result = await api.invoke('fs:create', parent, name, kind)
      if (!result.ok) return
      await refresh()
      if (kind === 'file') openFile(result.path)
      else setExpanded((prev) => new Set(prev).add(result.path))
    },
    [activePath, refresh, openFile],
  )

  useEffect(() => {
    if (!workspace) return
    return registerAppCommands(commands, {
      workspace,
      openPalette,
      closeVault: onCloseVault,
      toggleSidebar,
      newNote: () => void createIn('file'),
      newFolder: () => void createIn('folder'),
      revealActive: () => {
        if (activePath !== null) void api.invoke('fs:reveal', activePath)
      },
      setTheme: (theme) => update({ theme }),
      cycleTheme,
      goToSection,
    })
  }, [workspace, openPalette, onCloseVault, toggleSidebar, cycleTheme, goToSection, update, createIn, activePath])

  // User hotkey overrides, if hotkeys.json exists.
  useEffect(() => {
    void api.invoke('state:read', 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') {
        commands.setOverrides(saved as Record<string, string | null>)
      }
    })
  }, [])

  // One keydown listener for the whole app; everything routes through the registry.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
        return
      }
      if (commands.handleKeyEvent(ev)) ev.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  const showSidebar = appearance.sidebarOpen && activeSection.noPanel !== true

  return (
    <div className={`shell${ready ? '' : ' is-booting'}`}>
      <div className="shell__titlebar">
        <span className="shell__vault" title={vault.path}>
          {vault.name}
        </span>
      </div>

      <div className="shell__main">
        <Rail active={activeSection.id} sidebarOpen={appearance.sidebarOpen} onSelect={onRailSelect} />

        {showSidebar && (
          <Sidebar
            section={activeSection}
            width={appearance.sidebarWidth}
            onResize={(sidebarWidth) => update({ sidebarWidth })}
            actions={
              activeSection.id === 'data' ? (
                <div className="sidebar__actions">
                  <button className="icon-btn" title="New note (⌘N)" onClick={() => void createIn('file')}>
                    <Icon name="file-plus" size={15} />
                  </button>
                  <button className="icon-btn" title="New folder" onClick={() => void createIn('folder')}>
                    <Icon name="folder-plus" size={15} />
                  </button>
                </div>
              ) : undefined
            }
          >
            {activeSection.id === 'data' ? (
              <FileTree
                tree={tree}
                activePath={activePath}
                expanded={expanded}
                onToggleFolder={toggleFolder}
                onOpenFile={openFile}
                onChanged={() => void refresh()}
              />
            ) : undefined}
          </Sidebar>
        )}

        <main className="shell__content">
          {workspace ? (
            // `revision` is the subscription: Workspace is mutable, so React
            // needs an explicit signal that the tree changed.
            <WorkspaceView key={revision} workspace={workspace} />
          ) : (
            <div className="pane-empty">
              <p>Restoring layout…</p>
            </div>
          )}
        </main>
      </div>

      <StatusBar workspace={workspace} vaultName={vault.name} onOpenPalette={openPalette} />
      <CommandPalette registry={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
