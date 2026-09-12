import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { Breadcrumb } from '../components/Breadcrumb'
import { Icon } from '../components/Icon'
import { CommandPalette } from '../components/CommandPalette'
import { FileTree } from '../components/FileTree'
import { FloatingWindow } from '../components/FloatingWindow'
import { QuickSwitcher } from '../components/QuickSwitcher'
import type { LinkCandidate } from '../editor/link-complete'
import { SearchPanel } from '../components/SearchPanel'
import { Sidebar, SidebarStub } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { WorkspaceView } from '../components/WorkspaceView'
import { useAppearance, type Theme } from '../core/appearance'
import { commands } from '../core/commands'
import { allFolderPaths, filterTree } from '../core/file-tree-ops'
import { fuzzyMatch } from '../core/fuzzy'
import { formatChord } from '../core/hotkeys'
import { registerEditorCommands } from '../core/editor-commands'
import { registerAppCommands } from '../core/register-commands'
import { getSection, type SectionId } from '../core/sections'
import { useVault } from '../core/vault-store'
import { useWorkspace } from '../core/use-workspace'
import { getView } from '../core/view-registry'
import { registerArchiveView } from './ArchiveView'
import { registerMarkdownView } from './MarkdownView'
import { registerStubViews } from './stubs'
import { registerUnresolvedView } from './UnresolvedView'

type Props = {
  vault: VaultInfo
  onCloseVault: () => void
}

// Views register once per module load, before any layout is restored - otherwise
// a saved leaf would resolve to "unknown" on first paint.
registerStubViews()
registerArchiveView()

const THEME_CYCLE: readonly Theme[] = ['system', 'light', 'dark']

export function VaultShell({ vault, onCloseVault }: Props): React.ReactElement {
  const { sections, active, activeSection, setActiveSection, graphWindow, setGraphWindow, revision } =
    useWorkspace()
  const { appearance, ready, update } = useAppearance()
  const { tree, refresh } = useVault(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const section = getSection(activeSection)

  const activePath = useMemo(() => {
    const path = active?.activeLeaf?.state['path']
    return typeof path === 'string' ? path : null
  }, [active, revision])

  // --- sidebar list -------------------------------------------------------

  const visibleTree = useMemo(() => {
    if (query.trim() === '') return tree
    const roots = filterTree(tree.roots, query, (name) => fuzzyMatch(query, name) !== null)
    return { roots, byPath: tree.byPath }
  }, [tree, query])

  // A search result is useless collapsed, so while searching every folder is
  // open; the user's own expansion state is untouched underneath.
  const effectiveExpanded = useMemo(
    () => (query.trim() === '' ? expanded : new Set(allFolderPaths(visibleTree.roots))),
    [query, expanded, visibleTree.roots],
  )

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Registered here rather than at module scope because the markdown view needs
  // a callback into the shell to follow a wikilink.
  const markdownRegistered = useRef(false)
  if (!markdownRegistered.current) {
    markdownRegistered.current = true
    registerMarkdownView(
      (target, heading) => {
        void api.invoke('index:resolve-link', target).then((resolved) => {
          if (resolved !== null) openFileRef.current(resolved, heading)
        })
      },
      (p, heading) => openFileRef.current(p, heading ?? null),
      () => linkCandidatesRef.current,
      () => livePreviewRef.current,
    )
    registerUnresolvedView((p) => openFileRef.current(p))
  }

  const openFile = useCallback(
    (path: string, heading?: string | null) => {
      // Opening a note always lands in Data, even if you clicked from elsewhere.
      setActiveSection('data')
      // The heading is part of the leaf state, so reopening the tab from a
      // saved layout lands in the same place.
      sections?.data.openView('markdown', heading ? { path, heading } : { path })
    },
    [sections, setActiveSection],
  )

  // --- actions ------------------------------------------------------------

  // The link handler is created once, so it reads the current openFile via a ref.
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile

  /**
   * Note names for `[[` autocomplete.
   *
   * Held in a ref and read lazily by the editor, so the list is current without
   * the editor being rebuilt every time a file appears in the vault.
   */
  /**
   * Read lazily by the markdown view, so the mode is current without the view
   * being re-registered every time it changes.
   */
  const livePreviewRef = useRef(appearance.livePreview)
  livePreviewRef.current = appearance.livePreview

  const linkCandidatesRef = useRef<LinkCandidate[]>([])
  linkCandidatesRef.current = useMemo(() => {
    const out: LinkCandidate[] = []
    const walk = (nodes: readonly typeof tree.roots[number][]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') walk(node.children ?? [])
        else if (node.name.toLowerCase().endsWith('.md')) {
          const at = node.path.lastIndexOf('/')
          out.push({
            path: node.path,
            name: node.name.replace(/\.md$/i, ''),
            folder: at === -1 ? '' : node.path.slice(0, at),
          })
        }
      }
    }
    walk(tree.roots)
    return out
  }, [tree.roots])

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

  /** The sidebar's bottom-left button means something different per section. */
  const onNew = useCallback(() => {
    if (activeSection === 'data') void createIn('file')
    else active?.openView(section.viewType, { draft: Date.now() }, { reuse: false })
  }, [activeSection, createIn, active, section.viewType])

  const openExtension = useCallback(
    (type: string) => {
      active?.openView(type)
    },
    [active],
  )

  const toggleSidebar = useCallback(() => {
    update({ sidebarOpen: !appearance.sidebarOpen })
  }, [appearance.sidebarOpen, update])

  const cycleTheme = useCallback(() => {
    const at = THEME_CYCLE.indexOf(appearance.theme)
    update({ theme: THEME_CYCLE[(at + 1) % THEME_CYCLE.length] ?? 'system' })
  }, [appearance.theme, update])

  useEffect(() => {
    if (!active) return
    const offEditor = registerEditorCommands(commands, () => {
      update({ livePreview: !appearance.livePreview })
    })
    const offApp = registerAppCommands(commands, {
      workspace: active,
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
      goToSection: setActiveSection,
      toggleGraph: () => setGraphWindow({ open: !graphWindow.open }),
      openGraphFull: () => setGraphWindow({ open: true, maximized: true }),
      openExtension,
      openSearch: () => setSearchOpen(true),
      openSwitcher: () => setSwitcherOpen(true),
      reindex: () => void api.invoke('index:reindex'),
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
    appearance.livePreview,
    openExtension,
  ])

  useEffect(() => {
    void api.invoke('state:read', 'hotkeys').then((saved) => {
      if (saved !== null && typeof saved === 'object') {
        commands.setOverrides(saved as Record<string, string | null>)
      }
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && (paletteOpen || searchOpen || switcherOpen)) {
        setPaletteOpen(false)
        setSearchOpen(false)
        setSwitcherOpen(false)
        return
      }
      if (commands.handleKeyEvent(ev)) ev.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, searchOpen, switcherOpen])

  const graphView = getView('graph')

  return (
    <div className={`shell${ready ? '' : ' is-booting'}`}>
      <div className="shell__titlebar">
        <Breadcrumb path={activePath} fallback={vault.name} />
        {/*
          A permanent, visible toggle. Closing the graph used to leave no way
          back except a shortcut nobody had been told about - "it just
          disappears" is a fair description of that.
        */}
        <div className="shell__titlebar-actions">
          <button
            className={`titlebar-btn${graphWindow.open ? ' is-on' : ''}`}
            onClick={() => setGraphWindow({ open: !graphWindow.open })}
            title={`${graphWindow.open ? 'Hide' : 'Show'} graph (${formatChord('Mod+G')})`}
            aria-pressed={graphWindow.open}
          >
            <Icon name="git-fork" size={14} />
            <span>Graph</span>
          </button>
        </div>
      </div>

      <div className="shell__main">
        {appearance.sidebarOpen ? (
          <Sidebar
            vaultName={vault.name}
            activeSection={activeSection}
            onSelectSection={(id: SectionId) => setActiveSection(id)}
            query={query}
            onQueryChange={setQuery}
            width={appearance.sidebarWidth}
            onResize={(sidebarWidth) => update({ sidebarWidth })}
            onNew={onNew}
            onNewFolder={activeSection === 'data' ? () => void createIn('folder') : undefined}
            onOpenArchive={() => openExtension('archive')}
            onOpenSettings={() => openExtension('settings')}
            onCollapse={toggleSidebar}
          >
            {activeSection === 'data' ? (
              <FileTree
                tree={visibleTree}
                activePath={activePath}
                expanded={effectiveExpanded}
                onToggleFolder={toggleFolder}
                onOpenFile={openFile}
                onChanged={() => void refresh()}
              />
            ) : (
              <p className="sidebar__empty">
                {activeSection === 'ai'
                  ? 'Your conversations. Each one is a markdown file in the vault.'
                  : 'Your boards. Each card is a real note.'}
              </p>
            )}
          </Sidebar>
        ) : (
          <SidebarStub onExpand={toggleSidebar} />
        )}

        <main className="shell__content">
          {active ? (
            // Keyed by section only: switching workspace is a genuine remount,
            // a layout change inside one is not.
            <WorkspaceView key={activeSection} workspace={active} revision={revision} />
          ) : (
            <div className="pane-empty">
              <p>Restoring layout…</p>
            </div>
          )}
        </main>

        {graphWindow.open && (
          <FloatingWindow
            title="Graph"
            geometry={graphWindow}
            onChange={setGraphWindow}
            onClose={() => setGraphWindow({ open: false })}
            closeHint="Close graph (⌘G)"
          >
            {graphView?.render({
              state: { floating: true },
              setState: () => {},
              leafId: 'graph-window',
            })}
          </FloatingWindow>
        )}
      </div>

      <StatusBar
        workspace={active}
        vaultName={vault.name}
        graphOpen={graphWindow.open}
        onToggleGraph={() => setGraphWindow({ open: !graphWindow.open })}
        onOpenPalette={openPalette}
      />
      <CommandPalette registry={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} onOpenFile={openFile} />
      <QuickSwitcher
        open={switcherOpen}
        roots={tree.roots}
        onClose={() => setSwitcherOpen(false)}
        onOpen={openFile}
      />
    </div>
  )
}
