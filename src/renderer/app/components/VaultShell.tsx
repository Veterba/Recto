import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ATTACHMENTS_FOLDER, type VaultInfo } from '@shared/vault'
import { IPC } from '@shared/ipc'
import { api } from '../api'
import { Breadcrumb } from './Breadcrumb'
import { CommandPalette } from './CommandPalette'
import { ShellWindows } from './ShellWindows'
import { Sidebar, SidebarStub } from './Sidebar'
import { StatusBar } from './StatusBar'
import { WorkspaceView } from './WorkspaceView'
import { PaneDropOverlay } from './PaneDropOverlay'
import { NoteWindows } from './NoteWindows'
import { LinkPeekHost } from './LinkPeekHost'
import { closeNoteWindow, openNoteWindow } from '../note-windows'
import { closeLinkPeek } from '../link-peek'
import { setPaneDropHandler } from '../pane-drag'
import type { DropZone } from '../pane-drop'
import { registerStubViews } from './stub-views'
import { useAppearance, type Theme } from '../appearance'
import { commands } from '../commands'
import { getSection, type SectionId } from '../sections'
import { setVaultFiles, setVaultPath } from '../vault-url'
import { useVault } from '../vault-store'
import { setActiveNote } from '../note-bus'
import { useWorkspace } from '../hooks/use-workspace'
import { useWritingState } from '../hooks/use-writing-state'
import { useSectionDefaults } from '../hooks/use-section-defaults'
import { useShellNavigation } from '../hooks/use-shell-navigation'
import { useRegisterViews } from '../hooks/use-register-views'
import { useAppCommands } from '../hooks/use-app-commands'
import { useShellKeys } from '../hooks/use-shell-keys'
import { useShellCreate } from '../hooks/use-shell-create'
import { fuzzyMatch } from '../../ui/fuzzy'
import { FileTree, allFilePaths, allFolderPaths, filterTree, noteEntries, notePaths } from '../../features/file-tree'
import { focusEditorOnOpen, type LinkCandidate } from '../../features/editor'
import { QuickSwitcher, SearchPanel } from '../../features/search'
import { SettingsDialog, SidebarThemePicker } from '../../features/settings'
import { TemplatePicker, useDailyNoteAutoCreate, useTemplateActions, useTemplateSettings } from '../../features/templates'
import { TidyDialog, useTidy } from '../../features/tidy'
import { CHAT_FOLDER, ChatList } from '../../features/ai'
import { BoardList, CARD_FOLDER, useBoards } from '../../features/boards'
import { registerArchiveView } from '../../features/archive'
import { HomeOverlay } from '../../features/home'
import type { TemplateSettings } from '@shared/templates'

type Props = {
  vault: VaultInfo
  onCloseVault: () => void
  onSwitchVault: (target: string | null) => Promise<string | null>
}

// Views register once per module load, before any layout is restored - otherwise
// a saved leaf would resolve to "unknown" on first paint.
registerStubViews()
registerArchiveView()

const THEME_CYCLE: readonly Theme[] = ['system', 'light', 'dark']

export function VaultShell({ vault, onCloseVault, onSwitchVault }: Props): React.ReactElement {
  const {
    sections,
    active,
    activeSection,
    setActiveSection,
    graphWindow,
    setGraphWindow,
    historyWindow,
    setHistoryWindow,
    noteWindows,
    setNoteWindows,
    revision,
  } = useWorkspace()
  const { appearance, ready, update } = useAppearance()
  const boards = useBoards()
  const { tree, refresh } = useVault(true)
  const templates = useTemplateSettings(vault.path)
  const [homeOpen, setHomeOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themePicker, setThemePicker] = useState<{ x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const section = getSection(activeSection)

  const activePath = useMemo(() => {
    const path = active?.activeLeaf?.state['path']
    return typeof path === 'string' ? path : null
  }, [active, revision])

  // Published rather than passed down: the graph is a floating window, not a
  // child of the tab that knows which note is open.
  useEffect(() => setActiveNote(activePath), [activePath])

  // Image widgets resolve `attachments/x.png` against this.
  useEffect(() => setVaultPath(vault.path), [vault.path])

  useWritingState(vault.path)

  // `![[image.png]]` embeds find a file by name anywhere in the vault, the way
  // Obsidian does, so the editor needs every file's path - not just notes.
  useEffect(() => setVaultFiles(allFilePaths(tree.roots)), [tree.roots])

  /** Which conversation the AI workspace is showing. */
  const activeChat = useMemo(() => {
    const leaf = sections?.ai.activeLeaf
    const path = leaf?.type === 'chat' ? leaf.state['path'] : undefined
    return typeof path === 'string' ? path : null
  }, [sections, revision])

  /** Which board the Tasks workspace is showing, from its own active leaf. */
  const activeBoard = useMemo(() => {
    const leaf = sections?.tasks.activeLeaf
    const id = leaf?.type === 'board' ? leaf.state['board'] : undefined
    return typeof id === 'string' ? id : null
  }, [sections, revision])

  useSectionDefaults(activeSection, sections, revision, tree.roots, boards)

  // Read lazily by the chat view and new chats, which must always see the
  // current model and be able to change it.
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  const updateRef = useRef(update)
  updateRef.current = update

  const { openFile, openChat, newChat, openBoard, openBoardCard } = useShellNavigation(
    sections,
    setActiveSection,
    refresh,
    () => appearanceRef.current.aiModel,
  )

  // --- sidebar list -------------------------------------------------------

  /**
   * The Data tree, without the folder the board writes cards into.
   *
   * Cards and templates are real notes and have to live somewhere, but that
   * somewhere is an implementation detail of the features that own them - a
   * folder of them sitting in your file list is clutter you did not create.
   * They stay indexed, in the graph, findable by ⌘O and full-text search, and
   * openable from the board or the template picker; only this one list hides
   * them.
   */
  const visibleTree = useMemo(() => {
    // Templates are NOT hidden: they are notes the user writes and edits, so
    // the folder sits in the tree with its own icon. Cards and chats are the
    // app's storage for features that have their own screens.
    const hidden = new Set<string>([CARD_FOLDER, CHAT_FOLDER, ATTACHMENTS_FOLDER])
    const withoutCards = {
      roots: tree.roots.filter((node) => !(node.kind === 'folder' && hidden.has(node.path))),
      byPath: tree.byPath,
    }
    if (query.trim() === '') return withoutCards
    const roots = filterTree(withoutCards.roots, query, (name) => fuzzyMatch(query, name) !== null)
    return { roots, byPath: tree.byPath }
  }, [tree, query])

  /** Files in the attachments folder, for Settings - it is not in the tree any more. */
  const attachmentFiles = useMemo(() => {
    const folder = tree.roots.find((node) => node.kind === 'folder' && node.path === ATTACHMENTS_FOLDER)
    return folder?.kind === 'folder' ? allFilePaths(folder.children ?? []) : []
  }, [tree.roots])

  /**
   * Tabs whose note is gone are closed.
   *
   * The workspace is restored from disk, so it remembers every note it ever
   * had open - including ones since deleted or renamed elsewhere, which then
   * sit in the bar and fail to open. Runs once the tree is known and again on
   * every vault change.
   */
  useEffect(() => {
    if (sections === null || tree.roots.length === 0) return
    const files = new Set(allFilePaths(tree.roots))
    for (const workspace of Object.values(sections)) workspace.pruneMissing((path) => files.has(path))
    // A pinned note that is gone takes its window with it, as its tab would.
    setNoteWindows((prev) => (prev.every((w) => files.has(w.path)) ? prev : prev.filter((w) => files.has(w.path))))
  }, [sections, tree])

  /** Every folder in the vault, for expand-all. */
  const allFolders = useMemo(() => allFolderPaths(tree.roots), [tree.roots])

  /** Every note path, flattened once for Tidy and the template picker. */
  const allNotes = useMemo(() => notePaths(tree.roots), [tree.roots])

  const { tidy, setTidy, tidyBusy, openTidy, runTidy } = useTidy(allNotes, allFolders, templates.settings, refresh)

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

  // --- actions ------------------------------------------------------------

  /**
   * A drop on a pane lands in the workspace on screen: a dragged tab moves,
   * a note or a link's target opens, beside the pane or in it.
   */
  const activeRef = useRef(active)
  activeRef.current = active
  const setNoteWindowsRef = useRef(setNoteWindows)
  setNoteWindowsRef.current = setNoteWindows

  /**
   * Pin a note as a floating window where its preview card was, and put the
   * card away. Positions are the workspace area's, where the windows live.
   */
  const contentRef = useRef<HTMLElement | null>(null)
  const pinNote = useCallback(
    (path: string, rect: DOMRect) => {
      closeLinkPeek()
      const area = contentRef.current
      if (area === null) return
      const box = area.getBoundingClientRect()
      setNoteWindows((prev) =>
        openNoteWindow(prev, path, { x: rect.left - box.left, y: rect.top - box.top }, { width: box.width, height: box.height }),
      )
    },
    [setNoteWindows],
  )
  /** A link followed from a pinned note opens it in the main editor. */
  const openLinkInEditor = useCallback(
    (target: string, heading: string | null) => {
      void api.invoke(IPC.indexResolveLink, target).then((resolved) => {
        if (resolved !== null) openFile(resolved, heading)
      })
    },
    [openFile],
  )
  useEffect(() => {
    const open = (tabsId: string, zone: DropZone, path: string, heading?: string | null): void => {
      focusEditorOnOpen()
      activeRef.current?.placeInPane(tabsId, zone, { type: 'markdown', state: heading ? { path, heading } : { path } })
    }
    setPaneDropHandler((payload, tabsId, zone) => {
      if (payload.kind === 'leaf') activeRef.current?.placeInPane(tabsId, zone, { leafId: payload.leafId })
      else if (payload.kind === 'path') open(tabsId, zone, payload.path, payload.heading)
      else if (payload.kind === 'window') {
        // The window becomes the pane: the note opens there, and the window goes.
        open(tabsId, zone, payload.path)
        setNoteWindowsRef.current((prev) => closeNoteWindow(prev, payload.windowId))
      } else
        void api.invoke(IPC.indexResolveLink, payload.target).then((resolved) => {
          if (resolved !== null) open(tabsId, zone, resolved, payload.heading)
        })
    })
    return () => setPaneDropHandler(null)
  }, [])

  // The link handler is created once, so it reads the current openFile via a ref.
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  const openBoardCardRef = useRef(openBoardCard)
  openBoardCardRef.current = openBoardCard

  /**
   * Note names for `[[` autocomplete.
   *
   * Held in a ref and read lazily by the editor, so the list is current without
   * the editor being rebuilt every time a file appears in the vault.
   */
  const linkCandidatesRef = useRef<LinkCandidate[]>([])
  linkCandidatesRef.current = useMemo(() => noteEntries(tree.roots), [tree.roots])

  useRegisterViews({
    openFile: openFileRef,
    openBoardCard: openBoardCardRef,
    linkCandidates: linkCandidatesRef,
    appearance: appearanceRef,
    update: updateRef,
  })

  const { insertTemplate, updateTemplates, openDailyNote } = useTemplateActions({
    activePath,
    closePicker: () => setTemplatesOpen(false),
    byPath: tree.byPath,
    templates,
    refresh,
    openFile: openFileRef,
  })

  const settingsDepsRef = useRef({
    appearance,
    update,
    vault,
    onCloseVault,
    onSwitchVault,
    templates: templates.settings,
    updateTemplates: (_next: TemplateSettings) => {},
    notes: [] as string[],
    attachments: [] as string[],
    openDailyNote: () => {},
  })
  settingsDepsRef.current = {
    appearance,
    update,
    vault,
    onCloseVault,
    onSwitchVault,
    templates: templates.settings,
    updateTemplates: (next: TemplateSettings) => void updateTemplates(next),
    notes: allNotes,
    attachments: attachmentFiles,
    openDailyNote: () => void openDailyNote(),
  }

  const { createAt, createIn, onNew } = useShellCreate({
    refresh,
    setExpanded,
    openFile,
    activeSection,
    newChat,
    boards,
    activeBoard,
    openBoardCard,
    active,
    viewType: section.viewType,
  })

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

  useAppCommands({
    active,
    openPalette,
    setSettingsOpen,
    setTemplatesOpen,
    onCloseVault,
    toggleSidebar,
    createIn,
    activePath,
    update,
    livePreview: appearance.livePreview,
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
  })

  useDailyNoteAutoCreate(templates, refresh)

  useEffect(
    () =>
      commands.register({
        id: 'daily:open',
        name: "Open today's daily note",
        section: 'Open',
        icon: 'calendar-days',
        hotkey: 'Mod+Shift+D',
        run: () => void openDailyNote(),
      }),
    [openDailyNote],
  )

  useShellKeys({
    paletteOpen,
    searchOpen,
    switcherOpen,
    closePickers: () => {
      setPaletteOpen(false)
      setSearchOpen(false)
      setSwitcherOpen(false)
    },
  })

  return (
    <div className={`shell${ready ? '' : ' is-booting'}`}>
      <div className="shell__titlebar">
        <Breadcrumb path={activePath} fallback={vault.name} />
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
            foldersOpen={expanded.size > 0}
            onToggleFolders={activeSection === 'data' ? () => setExpanded(expanded.size > 0 ? new Set() : new Set(allFolders)) : undefined}
            onTidy={activeSection === 'data' ? () => void openTidy() : undefined}
            onOpenArchive={() => openExtension('archive')}
            onOpenSettings={() => setSettingsOpen(true)}
            onCollapse={toggleSidebar}
            onThemePick={setThemePicker}
          >
            {activeSection === 'data' ? (
              <FileTree
                tree={visibleTree}
                activePath={activePath}
                expanded={effectiveExpanded}
                onToggleFolder={toggleFolder}
                onOpenFile={openFile}
                onChanged={() => void refresh()}
                onCreateIn={(parent, kind) => void createAt(parent, kind)}
                vaultPath={vault.path}
                templateFolder={templates.settings.folder}
                aiModel={appearance.aiModel}
                previewDelayMs={appearance.previewDelay * 1000}
                onPinNote={pinNote}
              />
            ) : activeSection === 'tasks' ? (
              <BoardList activeBoard={activeBoard} query={query} onOpen={openBoard} />
            ) : (
              <ChatList tree={tree.roots} activePath={activeChat} query={query} onOpen={openChat} onChanged={() => void refresh()} />
            )}
          </Sidebar>
        ) : (
          <SidebarStub onExpand={toggleSidebar} />
        )}

        <main className="shell__content" ref={contentRef}>
          {active ? (
            // Keyed by section only: switching workspace is a genuine remount,
            // a layout change inside one is not.
            <WorkspaceView key={activeSection} workspace={active} revision={revision} />
          ) : (
            <div className="pane-empty">
              <p>Restoring layout…</p>
            </div>
          )}
          <NoteWindows
            windows={noteWindows}
            setWindows={setNoteWindows}
            area={contentRef}
            onOpenInEditor={(path) => openFile(path)}
            onOpenLink={openLinkInEditor}
          />
        </main>

        <ShellWindows
          graphWindow={graphWindow}
          setGraphWindow={setGraphWindow}
          historyWindow={historyWindow}
          setHistoryWindow={setHistoryWindow}
          activePath={activePath}
          onRestored={() => void refresh()}
        />
      </div>

      <StatusBar
        workspace={active}
        vaultName={vault.name}
        graphOpen={graphWindow.open}
        onToggleGraph={() => setGraphWindow({ open: !graphWindow.open })}
        onOpenDaily={() => void openDailyNote()}
        onOpenPalette={openPalette}
      />
      {templatesOpen && (
        <TemplatePicker
          notes={allNotes}
          folder={templates.settings.folder}
          onPick={(path) => void insertTemplate(path)}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {themePicker !== null && (
        <SidebarThemePicker at={themePicker} appearance={appearance} update={update} onClose={() => setThemePicker(null)} />
      )}
      {settingsOpen && <SettingsDialog {...settingsDepsRef.current} onClose={() => setSettingsOpen(false)} />}
      {tidy !== null && <TidyDialog plan={tidy} busy={tidyBusy} onConfirm={() => void runTidy()} onCancel={() => setTidy(null)} />}
      <HomeOverlay
        open={homeOpen}
        onClose={() => setHomeOpen(false)}
        sidebarWidth={appearance.sidebarOpen ? appearance.sidebarWidth : 0}
        vaultPath={vault.path}
        roots={tree.roots}
      />
      <CommandPalette registry={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} onOpenFile={openFile} />
      <QuickSwitcher open={switcherOpen} roots={tree.roots} onClose={() => setSwitcherOpen(false)} onOpen={openFile} />
      <LinkPeekHost
        delayMs={appearance.previewDelay * 1000}
        model={appearance.aiModel}
        mtimeOf={(path) => tree.byPath.get(path)?.mtime}
        onOpen={(path) => openFile(path)}
        onPin={pinNote}
      />
      <PaneDropOverlay />
    </div>
  )
}
