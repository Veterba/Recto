import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ATTACHMENTS_FOLDER, type FileNode, type VaultInfo } from '@shared/vault'
import { IPC } from '@shared/ipc'
import { api } from '../api'
import { Breadcrumb } from './Breadcrumb'
import { CommandPalette } from './CommandPalette'
import { ShellWindows } from './ShellWindows'
import { Sidebar, SidebarStub } from './Sidebar'
import { ShortcutSheet } from './ShortcutSheet'
import { StatusBar } from './StatusBar'
import { WorkspaceView } from './WorkspaceView'
import { PaneDropOverlay } from './PaneDropOverlay'
import { NoteWindows } from './NoteWindows'
import { LinkPeekHost } from './LinkPeekHost'
import { closeNoteWindow, openNoteWindow } from '../note-windows'
import { closeLinkPeek } from '../link-peek'
import { setPaneDropHandler } from '../pane-drag'
import { setRevealInTreeHandler } from '../reveal-in-tree'
import type { DropZone } from '../pane-drop'
import { registerStubViews } from './stub-views'
import { useAppearance, type BotPlace, type Theme } from '../appearance'
import { commands } from '../commands'
import { getSection, type SectionId } from '../sections'
import { setVaultFiles, setVaultPath } from '../vault-url'
import { useVault } from '../vault-store'
import { setActiveNote, useNoteBus } from '../note-bus'
import { useWorkspace } from '../hooks/use-workspace'
import { useWritingState } from '../hooks/use-writing-state'
import { useSectionDefaults } from '../hooks/use-section-defaults'
import { useShellNavigation } from '../hooks/use-shell-navigation'
import { useTabHistory } from '../hooks/use-tab-history'
import { useRegisterViews } from '../hooks/use-register-views'
import { useAppCommands } from '../hooks/use-app-commands'
import { useShellKeys } from '../hooks/use-shell-keys'
import { useShellCreate } from '../hooks/use-shell-create'
import { fuzzyMatch } from '../../ui/fuzzy'
import { FileTree, NameDialog, allFilePaths, allFolderPaths, filterTree, noteEntries, notePaths } from '../../features/file-tree'
import { focusEditorOnOpen, type LinkCandidate } from '../../features/editor'
import { QuickSwitcher, SearchPanel } from '../../features/search'
import { SettingsPanel, SidebarThemePicker, type SettingsTab } from '../../features/settings'
import { TemplatePicker, usePeriodicNotesAutoCreate, useTemplateActions, useTemplateSettings } from '../../features/templates'
import { TidyDialog, useTidy } from '../../features/tidy'
import { onOpenTopic, reloadBots, requestTopic, useBots } from '../../features/bots'
import { ChatsPanel, FloatingBot, QuickAsk, setChatsOpener, setChatsPanel } from '../../features/chats'
import { setSettingsHandler } from '../settings-request'
import {
  BoardDeleteHost,
  BoardList,
  BoardsMigrationNotice,
  LayoutMigrationNotice,
  isTaskPath,
  loadRectoFolderSetting,
  refreshBoards,
  requestNewCard,
  useBoards,
  useCardPlaces,
  useShowRectoFolder,
} from '../../features/boards'
import { registerArchiveView } from '../../features/archive'
import { HomeOverlay, forgetFigures, loadPlace } from '../../features/home'
import { useUsageTracking } from '../usage'
import type { Period, TemplateSettings } from '@shared/templates'

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

/** Where the bot stands on a board: the bottom-right corner, clear of the lanes. */
const BOARD_BOT_PLACE: BotPlace = { edge: 'right', at: 1 }

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
  /** Read by the tab pruning without running it again on every window change. */
  const noteWindowsRef = useRef(noteWindows)
  noteWindowsRef.current = noteWindows
  const templates = useTemplateSettings(vault.path)
  const [homeOpen, setHomeOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** "New file…" is asking for a name, to go in this folder. */
  const [newFileIn, setNewFileIn] = useState<string | null>(null)
  const [newFileError, setNewFileError] = useState<string | null>(null)
  /** The ⌘/ cheat sheet. */
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** The tab Settings opens on, when something asked for a particular one. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined)
  /** Counts requests to open Settings: one while it is open focuses it. */
  const [settingsRequest, setSettingsRequest] = useState(0)
  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
    setSettingsRequest((n) => n + 1)
  }, [])
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

  // The overview's time in Recto and "last opened"; where it was left, read now so ⌃⌘H never waits.
  useUsageTracking(activePath)
  useEffect(() => {
    forgetFigures()
    void loadPlace()
  }, [])

  useWritingState(vault.path)

  // `![[image.png]]` embeds find a file by name anywhere in the vault, the way
  // Obsidian does, so the editor needs every file's path - not just notes.
  useEffect(() => setVaultFiles(allFilePaths(tree.roots)), [tree.roots])

  // Bot definitions are per vault, and edited by hand outside the watched notes.
  useEffect(() => reloadBots(), [vault.path])

  /** Which board note the Tasks workspace is showing, from its own active leaf. */
  const activeBoard = useMemo(() => {
    const leaf = sections?.tasks.activeLeaf
    const path = leaf?.type === 'board' ? leaf.state['path'] : undefined
    return typeof path === 'string' ? path : null
  }, [sections, revision])

  // Navigation that comes without a press or a key the preview card already
  // heard (a command run, a link followed, a view restored): it puts the card
  // away too, and any on its way.
  useEffect(() => closeLinkPeek(), [activeSection, activePath, revision, homeOpen, settingsOpen, paletteOpen, searchOpen, switcherOpen])

  // Boards are notes: the list, and where each card stands, follow the vault.
  // Asked again a moment later, when the indexer - a process behind - has read the change.
  const { revision: notesRevision } = useNoteBus()
  useEffect(() => {
    refreshBoards()
    const timer = window.setTimeout(refreshBoards, 1200)
    return () => window.clearTimeout(timer)
  }, [notesRevision, vault.path])

  useSectionDefaults(activeSection, sections, revision, tree.roots, boards)

  // Read lazily by the chat view and new chats, which must always see the
  // current model and be able to change it.
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  const updateRef = useRef(update)
  updateRef.current = update

  const { openFile, openBoard, openBoardCard, openBot } = useShellNavigation(sections, activeSection, setActiveSection)
  useTabHistory(sections, activeSection)

  // A notification about a finished answer was clicked: open that bot's chat at that topic.
  const bots = useBots()
  const openBotRef = useRef(openBot)
  openBotRef.current = openBot
  useEffect(
    () =>
      onOpenTopic(({ botId, topic }) => {
        const bot = bots?.find((b) => b.id === botId)
        if (bot === undefined) return
        requestTopic(botId, topic)
        void openBotRef.current(bot)
      }),
    [bots],
  )

  // --- sidebar list -------------------------------------------------------

  /**
   * The Data tree, without what Recto's own screens own: the Recto folder, and
   * every board and card note wherever it is (isTaskPath, one rule). A
   * setting (Settings → Vault) shows them.
   *
   * Cards, boards and templates are real notes and have to live somewhere, but
   * that somewhere is an implementation detail of the features that own them -
   * a folder of them sitting in your file list is clutter you did not create.
   * They stay indexed, in the graph, findable by ⌘O and full-text search, and
   * a [[link]] opens them; only this one list hides them.
   */
  const cardPlaces = useCardPlaces()
  const showRecto = useShowRectoFolder()
  /** Times the boards migration's notice closed (or had nothing to say): each lets the layout one ask again. */
  const [boardsNoticeSettled, setBoardsNoticeSettled] = useState(0)
  const onBoardsNoticeSettled = useCallback(() => setBoardsNoticeSettled((n) => n + 1), [])
  useEffect(() => loadRectoFolderSetting(vault.path), [vault.path])
  const visibleTree = useMemo(() => {
    // Templates are NOT hidden: they are notes the user writes and edits, so
    // the folder sits in the tree with its own icon. Chats and attachments are
    // the app's storage for features that have their own screens.
    const hidden = new Set<string>([ATTACHMENTS_FOLDER])
    const prune = (nodes: readonly FileNode[]): FileNode[] =>
      nodes.flatMap((node) => {
        if ((!showRecto && isTaskPath(node.path)) || (node.kind === 'folder' && hidden.has(node.path))) return []
        return node.children === undefined ? [node] : [{ ...node, children: prune(node.children) }]
      })
    const withoutCards = { roots: prune(tree.roots), byPath: tree.byPath }
    if (query.trim() === '') return withoutCards
    const roots = filterTree(withoutCards.roots, query, (name) => fuzzyMatch(query, name) !== null)
    return { roots, byPath: tree.byPath }
    // `boards` and `cardPlaces` are what isTaskPath reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, query, boards, cardPlaces, showRecto])

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
   *
   * A path the tree does not list is asked of the disk before its tab goes:
   * the tree can be a moment behind a note just made (a new board opened at
   * once was closed again, and Tasks fell back to its first board).
   */
  useEffect(() => {
    if (sections === null || tree.roots.length === 0) return
    const files = new Set(allFilePaths(tree.roots))
    const unlisted = [...new Set([...Object.values(sections).flatMap((workspace) => workspace.paths()), ...noteWindowsRef.current.map((w) => w.path)])].filter(
      (path) => !files.has(path),
    )
    if (unlisted.length === 0) return
    let stale = false
    void api.invoke(IPC.fsExisting, unlisted).then((onDisk) => {
      if (stale) return
      const exists = (path: string): boolean => files.has(path) || onDisk.includes(path)
      for (const workspace of Object.values(sections)) workspace.pruneMissing(exists)
      // A pinned note that is gone takes its window with it, as its tab would.
      setNoteWindows((prev) => (prev.every((w) => exists(w.path)) ? prev : prev.filter((w) => exists(w.path))))
    })
    return () => {
      stale = true
    }
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
    setPaneDropHandler((payload, tabsId, zone, slot) => {
      if (payload.kind === 'leaf' && slot !== undefined) {
        // Dropped on a tab strip: the tab goes to that place in the row.
        activeRef.current?.moveLeaf(payload.leafId, tabsId, slot.index)
        activeRef.current?.setActiveLeaf(payload.leafId)
      } else if (payload.kind === 'leaf') activeRef.current?.placeInPane(tabsId, zone, { leafId: payload.leafId })
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
  const openBoardRef = useRef(openBoard)
  openBoardRef.current = openBoard

  /**
   * Note names for `[[` autocomplete.
   *
   * Held in a ref and read lazily by the editor, so the list is current without
   * the editor being rebuilt every time a file appears in the vault.
   */
  const linkCandidatesRef = useRef<LinkCandidate[]>([])
  linkCandidatesRef.current = useMemo(() => noteEntries(tree.roots), [tree.roots])

  // Set further down, once what they point at exists; read only when an overview tab is used.
  const openFolderRef = useRef<(name: string) => void>(() => {})
  const noteExistsRef = useRef<(path: string) => boolean>(() => false)
  const rootsRef = useRef<readonly FileNode[]>(tree.roots)
  rootsRef.current = tree.roots
  const sectionRef = useRef(activeSection)
  sectionRef.current = activeSection
  const createNamedRef = useRef<(parent: string, name: string) => Promise<string | null>>(async () => null)
  useRegisterViews({
    openFile: openFileRef,
    openFolder: openFolderRef,
    noteExists: noteExistsRef,
    openBoardCard: openBoardCardRef,
    openBoard: openBoardRef,
    linkCandidates: linkCandidatesRef,
    appearance: appearanceRef,
    update: updateRef,
    roots: rootsRef,
    section: sectionRef,
    createNamed: createNamedRef,
  })

  const openPeriodicSettings = useCallback(() => openSettings('periodic'), [openSettings])

  // --- the vault overview (⌃⌘H) ---
  const closeHome = useCallback(() => setHomeOpen(false), [])
  const noteExists = useCallback((path: string) => tree.byPath.has(path), [tree.byPath])
  const templateFolder = templates.settings.folder
  const isTemplate = useCallback((path: string) => templateFolder !== '' && path.startsWith(`${templateFolder}/`), [templateFolder])
  const openCardFromHome = useCallback(
    (path: string) => {
      setActiveSection('tasks')
      openBoardCard(path)
    },
    [setActiveSection, openBoardCard],
  )
  /** A folder from "Most written in": the notes, with that folder open in the tree. */
  const openFolderFromHome = useCallback(
    (name: string) => {
      setActiveSection('data')
      setExpanded((prev) => new Set(prev).add(name))
    },
    [setActiveSection],
  )
  openFolderRef.current = openFolderFromHome
  noteExistsRef.current = noteExists
  const { insertTemplate, updateTemplates, openPeriodicNote, openTodayNote } = useTemplateActions({
    activePath,
    closePicker: () => setTemplatesOpen(false),
    byPath: tree.byPath,
    notes: allNotes,
    templates,
    refresh,
    openFile: openFileRef,
    openPeriodicSettings,
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
    folders: [] as string[],
    attachments: [] as string[],
    openPeriodicNote: (_period: Period) => {},
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
    folders: allFolders,
    attachments: attachmentFiles,
    openPeriodicNote: (period: Period) => void openPeriodicNote(period),
  }

  /**
   * A file or folder renamed from the tree: its open tabs follow it, and so
   * does a tab of anything inside a renamed folder. They used to close, as for
   * a deleted file. The tab shows what the file now is - a note renamed to
   * "x.py" reopens in the code editor.
   */
  const followRename = useCallback(
    (from: string, to: string) => {
      if (sections === null) return
      // Its steps in every tab's history follow too.
      for (const workspace of Object.values(sections)) workspace.renamePath(from, to)
    },
    [sections],
  )

  const { createAt, createIn, createNamed, onNew } = useShellCreate({
    refresh,
    setExpanded,
    openFile,
    activeSection,
    boards,
    activeBoard,
    openBoardCard,
    active,
    viewType: section.viewType,
    askFileName: setNewFileIn,
  })
  createNamedRef.current = createNamed

  const openExtension = useCallback(
    (type: string) => {
      active?.openView(type)
    },
    [active],
  )

  const toggleSidebar = useCallback(() => {
    update({ sidebarOpen: !appearance.sidebarOpen })
  }, [appearance.sidebarOpen, update])

  /** A file shown in the Data tree: sidebar open, its folders expanded. */
  useEffect(() => {
    setRevealInTreeHandler((path) => {
      setActiveSection('data')
      if (!appearance.sidebarOpen) update({ sidebarOpen: true })
      setExpanded((prev) => {
        const next = new Set(prev)
        const parts = path.split('/')
        for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
        return next
      })
    })
    return () => setRevealInTreeHandler(null)
  }, [appearance.sidebarOpen, update, setActiveSection])

  const cycleTheme = useCallback(() => {
    const at = THEME_CYCLE.indexOf(appearance.theme)
    update({ theme: THEME_CYCLE[(at + 1) % THEME_CYCLE.length] ?? 'system' })
  }, [appearance.theme, update])

  // --- the Chats panel, the floating bot, Quick ask ------------------------

  useEffect(() => {
    setSettingsHandler(openSettings)
    return () => setSettingsHandler(null)
  }, [openSettings])

  /**
   * The Chats panel and the graph share the right side, one at a time:
   * opening the panel puts a graph that was open away, and closing the panel
   * brings it back; opening the graph closes the panel.
   */
  const graphByChats = useRef(false)
  const setChats = useCallback(
    (open: boolean) => {
      if (open === appearance.chatsOpen) return
      if (open && graphWindow.open) {
        graphByChats.current = true
        setGraphWindow({ open: false })
      } else if (!open && graphByChats.current) {
        graphByChats.current = false
        setGraphWindow({ open: true })
      }
      update({ chatsOpen: open })
    },
    [appearance.chatsOpen, graphWindow.open, setGraphWindow, update],
  )
  const chatsOpenRef = useRef(appearance.chatsOpen)
  chatsOpenRef.current = appearance.chatsOpen
  useEffect(() => {
    if (graphWindow.open && chatsOpenRef.current) {
      graphByChats.current = false
      update({ chatsOpen: false })
    }
  }, [graphWindow.open, update])
  useEffect(() => {
    setChatsPanel({ open: appearance.chatsOpen, toggle: () => setChats(!appearance.chatsOpen) })
    setChatsOpener(() => setChats(true))
  }, [appearance.chatsOpen, setChats])

  const [quickAskOpen, setQuickAskOpen] = useState(false)
  /** Every floating window and the bot out of sight, without closing them (⌘⇧H again brings them back). */
  const [floatsHidden, setFloatsHidden] = useState(false)
  const toggleFloatingBot = useCallback(() => {
    if (appearance.floatingBot) setQuickAskOpen(false)
    update({ floatingBot: !appearance.floatingBot })
  }, [appearance.floatingBot, update])
  // On a board the lanes fill the page: the bot keeps to its bottom-right corner there and is not moved.
  const botPlace: BotPlace = activeSection === 'tasks' ? BOARD_BOT_PLACE : appearance.botPlace
  const activeNote = activePath !== null && activePath.toLowerCase().endsWith('.md') ? activePath : null

  useEffect(
    () =>
      commands.registerAll([
        {
          id: 'chats:toggle',
          name: 'Toggle chats',
          section: 'AI',
          icon: 'messages-square',
          hotkey: 'Mod+Shift+C',
          run: () => setChats(!chatsOpenRef.current),
        },
        {
          id: 'bot:toggle-floating',
          name: 'Show or hide the floating bot',
          section: 'AI',
          icon: 'bot',
          hotkey: 'Mod+Shift+B',
          run: toggleFloatingBot,
        },
        {
          id: 'quick-ask:open',
          name: 'Quick ask about this note',
          section: 'AI',
          icon: 'sparkles',
          hotkey: 'Mod+J',
          run: () => {
            setFloatsHidden(false)
            setQuickAskOpen((open) => !open)
          },
        },
        {
          id: 'windows:hide-all',
          name: 'Hide or show floating windows',
          section: 'Window',
          icon: 'minimize',
          hotkey: 'Mod+Shift+H',
          run: () => setFloatsHidden((hidden) => !hidden),
        },
      ]),
    [setChats, toggleFloatingBot],
  )

  useAppCommands({
    active,
    openPalette,
    setSettingsOpen: (open: boolean) => (open ? openSettings() : setSettingsOpen(false)),
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
    setShortcutsOpen,
  })

  usePeriodicNotesAutoCreate(templates, allNotes, refresh, settingsOpen)

  useEffect(() => {
    const off = commands.registerAll([
      {
        id: 'daily:open',
        name: 'Open today',
        section: 'Periodic notes',
        icon: 'calendar-days',
        hotkey: 'Mod+Shift+D',
        run: () => void openTodayNote(),
      },
      {
        id: 'weekly:open',
        name: 'Open this week',
        section: 'Periodic notes',
        icon: 'calendar-range',
        run: () => void openPeriodicNote('weekly'),
      },
      {
        id: 'monthly:open',
        name: 'Open this month',
        section: 'Periodic notes',
        icon: 'calendar',
        run: () => void openPeriodicNote('monthly'),
      },
      {
        id: 'yearly:open',
        name: 'Open this year',
        section: 'Periodic notes',
        icon: 'calendar',
        run: () => void openPeriodicNote('yearly'),
      },
      {
        id: 'tasks:new-card',
        name: 'New card',
        section: 'Tasks',
        icon: 'square-kanban',
        // The board on screen, or the first one; the popover there asks for the column.
        run: () => {
          const path = activeBoard ?? boards[0]?.path
          if (path === undefined) return
          openBoard(path)
          requestNewCard()
        },
      },
      {
        // The overview as a tab rather than the overlay: its lists, and notes opened from it, are steps in the tab's history.
        id: 'home:overview-tab',
        name: 'Open overview in a tab',
        section: 'Vault',
        icon: 'house',
        run: () => {
          sections?.[activeSection].openView('overview', { view: { kind: 'main' } })
        },
      },
    ])
    return off
  }, [openPeriodicNote, openTodayNote, activeBoard, boards, openBoard, sections, activeSection])

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

      <div className={`shell__main${floatsHidden ? ' is-floats-hidden' : ''}`}>
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
            onOpenSettings={() => openSettings()}
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
                onRenamed={followRename}
                vaultPath={vault.path}
                templateFolder={templates.settings.folder}
              />
            ) : activeSection === 'tasks' ? (
              <BoardList activeBoard={activeBoard} query={query} onOpen={openBoard} vaultPath={vault.path} onRenamed={followRename} />
            ) : (
              <p className="sidebar__soon">Canvas is coming soon.</p>
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
          {quickAskOpen && (
            <QuickAsk
              note={activeNote}
              place={botPlace}
              pointing={appearance.floatingBot}
              area={contentRef}
              openFile={(path) => openFile(path)}
              onClose={() => setQuickAskOpen(false)}
            />
          )}
          {appearance.floatingBot && (
            <FloatingBot
              place={botPlace}
              onPlace={activeSection === 'tasks' ? undefined : (place) => update({ botPlace: place })}
              onClick={() => setQuickAskOpen((open) => !open)}
              state={quickAskOpen ? 'listening' : 'idle'}
              active={quickAskOpen}
            />
          )}
        </main>

        {appearance.chatsOpen && (
          <ChatsPanel
            width={appearance.chatsWidth}
            onResize={(chatsWidth) => update({ chatsWidth })}
            tree={tree.roots}
            openFile={(path, heading) => openFile(path, heading ?? null)}
            notes={() => linkCandidatesRef.current}
            onOpenSettings={() => openSettings('bots')}
            floatingBot={appearance.floatingBot}
            onToggleFloatingBot={toggleFloatingBot}
            onClose={() => setChats(false)}
          />
        )}

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
        floatingBot={appearance.floatingBot}
        onToggleFloatingBot={toggleFloatingBot}
        onOpenDaily={() => void openTodayNote()}
        onOpenPalette={openPalette}
      />
      {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} />}
      {newFileIn !== null && (
        <NameDialog
          title="New file"
          submitLabel="Create"
          path={newFileIn === '' ? `${vault.name}/` : `${newFileIn}/`}
          initial=""
          select={0}
          error={newFileError}
          onSubmit={(name) => {
            const parent = newFileIn
            // Stays open on a taken name, saying which file has it.
            void createNamed(parent, name).then((error) => {
              setNewFileError(error)
              if (error === null) setNewFileIn(null)
            })
          }}
          onCancel={() => {
            setNewFileIn(null)
            setNewFileError(null)
          }}
        />
      )}
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
      {settingsOpen && (
        <SettingsPanel
          {...settingsDepsRef.current}
          initialTab={settingsTab}
          focusRequest={settingsRequest}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsTab(undefined)
          }}
        />
      )}
      <BoardDeleteHost />
      <BoardsMigrationNotice vaultPath={vault.path} onOpenBoard={(path) => openBoard(path)} onSettled={onBoardsNoticeSettled} />
      <LayoutMigrationNotice vaultPath={vault.path} asks={boardsNoticeSettled} />
      {tidy !== null && <TidyDialog plan={tidy} busy={tidyBusy} onConfirm={() => void runTidy()} onCancel={() => setTidy(null)} />}
      <HomeOverlay
        open={homeOpen}
        onClose={closeHome}
        sidebarWidth={appearance.sidebarOpen ? appearance.sidebarWidth : 0}
        vaultPath={vault.path}
        roots={tree.roots}
        vaultName={vault.name}
        exists={noteExists}
        isTemplate={isTemplate}
        // The overview you opened it from is a step back from the note.
        onOpenNote={(path, view) => openFile(path, null, { type: 'overview', state: { view } })}
        onOpenCard={openCardFromHome}
        onOpenFolder={openFolderFromHome}
      />
      <CommandPalette registry={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} onOpenFile={openFile} />
      <QuickSwitcher open={switcherOpen} roots={tree.roots} onClose={() => setSwitcherOpen(false)} onOpen={openFile} />
      <LinkPeekHost
        delayMs={appearance.previewDelay * 1000}
        mtimeOf={(path) => tree.byPath.get(path)?.mtime}
        onOpen={(path) => openFile(path)}
        onPin={pinNote}
      />
      <PaneDropOverlay />
    </div>
  )
}
