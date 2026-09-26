import { useEffect } from 'react'
import { api } from '../api'
import { IPC } from '@shared/ipc'
import { commands } from '../commands'
import type { Appearance } from '../appearance'
import type { SectionId } from '../sections'
import type { WorkspaceApi } from './use-workspace'
import { registerAppCommands } from '../register-commands'
import { registerEditorCommands } from '../../features/editor'

/** The app's and the editor's commands, registered for as long as there is a workspace. */
export function useAppCommands({
  active,
  openPalette,
  setSettingsOpen,
  setTemplatesOpen,
  onCloseVault,
  toggleSidebar,
  createIn,
  activePath,
  update,
  livePreview,
  cycleTheme,
  setActiveSection,
  graphWindow,
  setGraphWindow,
  historyWindow,
  setHistoryWindow,
  openExtension,
  setSearchOpen,
  setSwitcherOpen,
  setHomeOpen,
}: {
  active: WorkspaceApi['active']
  openPalette: () => void
  setSettingsOpen: (open: boolean) => void
  setTemplatesOpen: (open: boolean) => void
  onCloseVault: () => void
  toggleSidebar: () => void
  createIn: (kind: 'file' | 'folder') => Promise<void>
  activePath: string | null
  update: (patch: Partial<Appearance>) => void
  livePreview: boolean
  cycleTheme: () => void
  setActiveSection: (id: SectionId) => void
  graphWindow: WorkspaceApi['graphWindow']
  setGraphWindow: WorkspaceApi['setGraphWindow']
  historyWindow: WorkspaceApi['historyWindow']
  setHistoryWindow: WorkspaceApi['setHistoryWindow']
  openExtension: (type: string) => void
  setSearchOpen: (open: boolean) => void
  setSwitcherOpen: (open: boolean) => void
  setHomeOpen: React.Dispatch<React.SetStateAction<boolean>>
}): void {
  useEffect(() => {
    if (!active) return
    const offEditor = registerEditorCommands(commands, () => {
      update({ livePreview: !livePreview })
    })
    const offApp = registerAppCommands(commands, {
      workspace: active,
      openPalette,
      openSettings: () => setSettingsOpen(true),
      openTemplates: () => setTemplatesOpen(true),
      closeVault: onCloseVault,
      toggleSidebar,
      newNote: () => void createIn('file'),
      newFolder: () => void createIn('folder'),
      revealActive: () => {
        if (activePath !== null) void api.invoke(IPC.fsReveal, activePath)
      },
      setTheme: (theme) => update({ theme }),
      cycleTheme,
      goToSection: setActiveSection,
      toggleGraph: () => setGraphWindow({ open: !graphWindow.open }),
      openGraphFull: () => setGraphWindow({ open: true, maximized: true }),
      openExtension,
      openSearch: () => setSearchOpen(true),
      openSwitcher: () => setSwitcherOpen(true),
      toggleHome: () => setHomeOpen((open) => !open),
      toggleHistory: () => setHistoryWindow({ open: !historyWindow.open }),
      reindex: () => void api.invoke(IPC.indexReindex),
    })
    return () => {
      offApp()
      offEditor()
    }
  }, [
    active,
    openPalette,
    onCloseVault,
    toggleSidebar,
    cycleTheme,
    setActiveSection,
    update,
    createIn,
    activePath,
    graphWindow.open,
    setGraphWindow,
    historyWindow.open,
    setHistoryWindow,
    livePreview,
    openExtension,
  ])
}
