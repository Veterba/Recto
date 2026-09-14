import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileNode, VaultInfo } from '@shared/ipc-contract'
import { api } from '../api'
import { Breadcrumb } from '../components/Breadcrumb'
import { Icon } from '../components/Icon'
import { CommandPalette } from '../components/CommandPalette'
import { FileTree } from '../components/FileTree'
import { FloatingWindow } from '../components/FloatingWindow'
import { History } from '../components/History'
import { QuickSwitcher } from '../components/QuickSwitcher'
import type { LinkCandidate } from '../editor/link-complete'
import { SearchPanel } from '../components/SearchPanel'
import { Sidebar, SidebarStub } from '../components/Sidebar'
import { SidebarThemePicker } from '../components/SidebarThemePicker'
import { StatusBar } from '../components/StatusBar'
import { TemplatePicker } from '../components/TemplatePicker'
import { TidyDialog } from '../components/TidyDialog'
import { planTidy, type TidyPlan } from '../core/tidy'
import { fillTemplate, templateBody, type TemplateSettings } from '../core/templates'
import { dayKey, ensureDailyNote, retemplateDailyNote, useTemplateSettings } from '../core/daily-note'
import { getActiveEditor } from './MarkdownView'
import { WorkspaceView } from '../components/WorkspaceView'
import { useAppearance, type Theme } from '../core/appearance'
import { commands } from '../core/commands'
import { allFolderPaths, filterTree } from '../core/file-tree-ops'
import { fuzzyMatch } from '../core/fuzzy'
import { registerEditorCommands } from '../core/editor-commands'
import { registerAppCommands } from '../core/register-commands'
import { getSection, type SectionId } from '../core/sections'
import { setVaultFiles, setVaultPath } from '../core/vault-url'
import { useVault } from '../core/vault-store'
import { useWorkspace } from '../core/use-workspace'
import { getView } from '../core/view-registry'
import { ChatList } from '../ai/ChatList'
import { CHAT_FOLDER, chatFileName, serialiseConversation } from '../ai/conversation'
import { registerChatView } from '../ai/ChatView'
import { BoardList } from '../board/BoardList'
import { registerBoardView } from '../board/BoardView'
import { CARD_FOLDER, createCard } from '../board/create-card'
import { useBoards } from '../board/use-boards'
import { registerGraphView } from '../graph/GraphView'
import { setActiveNote, noteIndexChanged } from '../core/note-bus'
import { registerArchiveView } from './ArchiveView'
import { registerMarkdownView } from './MarkdownView'
import { SettingsDialog } from './SettingsView'
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
  const {
    sections,
    active,
    activeSection,
    setActiveSection,
    graphWindow,
    setGraphWindow,
    historyWindow,
    setHistoryWindow,
    revision,
  } = useWorkspace()
  const { appearance, ready, update } = useAppearance()
  const boards = useBoards()
  const { tree, refresh } = useVault(true)
  const templates = useTemplateSettings(vault.path)
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

  // `![[image.png]]` embeds find a file by name anywhere in the vault, the way
  // Obsidian does, so the editor needs every file's path - not just notes.
  useEffect(() => {
    const paths: string[] = []
    const walk = (nodes: readonly FileNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') walk(node.children ?? [])
        else paths.push(node.path)
      }
    }
    walk(tree.roots)
    setVaultFiles(paths)
  }, [tree.roots])

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

  /**
   * An empty AI workspace opens the most recent conversation.
   *
   * Same reasoning as Tasks below: arriving at a blank pane and having to work
   * out that the thing you want is in the sidebar is a worse first second than
   * landing in the conversation you had last.
   */
  useEffect(() => {
    if (activeSection !== 'ai') return
    const ai = sections?.ai
    if (ai === undefined || ai.activeLeaf !== null) return
    const folder = tree.roots.find((node) => node.kind === 'folder' && node.path === CHAT_FOLDER)
    const newest = (folder?.children ?? [])
      .filter((node) => node.kind === 'file' && node.name.toLowerCase().endsWith('.md'))
      .map((node) => node.path)
      .sort((a, b) => b.localeCompare(a))[0]
    if (newest !== undefined) ai.openView('chat', { path: newest })
  }, [activeSection, sections, revision, tree.roots])

  /**
   * An empty Tasks workspace opens its first board.
   *
   * Without this, switching to Tasks the first time shows an empty pane and
   * leaves you to work out that a board lives in the sidebar.
   */
  useEffect(() => {
    if (activeSection !== 'tasks') return
    const tasks = sections?.tasks
    if (tasks === undefined || tasks.activeLeaf !== null) return
    const first = boards.boards[0]
    if (first !== undefined) tasks.openView('board', { board: first.id })
  }, [activeSection, sections, revision, boards])

  const openChat = useCallback(
    (path: string) => {
      setActiveSection('ai')
      sections?.ai.openView('chat', { path })
    },
    [sections, setActiveSection],
  )

  /**
   * A new conversation is a new note, created up front rather than on the first
   * message. It costs one empty file and buys the invariant the whole feature
   * rests on: the thing on screen always has somewhere on disk to be.
   */
  const newChat = useCallback(async () => {
    const created = await api.invoke('fs:create', CHAT_FOLDER, chatFileName(new Date()), 'file')
    if (!created.ok) return
    await api.invoke(
      'fs:write',
      created.path,
      // No `created:` field: the filename IS the timestamp, and two records of
      // the same fact drift.
      serialiseConversation({ title: 'New chat', model: appearanceRef.current.aiModel, messages: [] }),
    )
    await refresh()
    openChat(created.path)
  }, [refresh, openChat])

  const openBoard = useCallback(
    (id: string) => {
      setActiveSection('tasks')
      sections?.tasks.openView('board', { board: id })
    },
    [sections, setActiveSection],
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
    const hidden = new Set<string>([CARD_FOLDER, CHAT_FOLDER])
    const withoutCards = {
      roots: tree.roots.filter((node) => !(node.kind === 'folder' && hidden.has(node.path))),
      byPath: tree.byPath,
    }
    if (query.trim() === '') return withoutCards
    const roots = filterTree(withoutCards.roots, query, (name) => fuzzyMatch(query, name) !== null)
    return { roots, byPath: tree.byPath }
  }, [tree, query])

  /** Every folder in the vault, for expand-all. */
  const allFolders = useMemo(() => allFolderPaths(tree.roots), [tree.roots])

  /** Every note path, flattened once for Tidy and the template picker. */
  const allNotes = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: readonly FileNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') walk(node.children ?? [])
        else if (node.name.toLowerCase().endsWith('.md')) out.push(node.path)
      }
    }
    walk(tree.roots)
    return out
  }, [tree.roots])

  /**
   * Insert a template at the cursor.
   *
   * Its own frontmatter is dropped first: a template is a note, so it may have
   * picked some up, and a second `---` block halfway down a file is a rule and
   * a pile of stray text rather than metadata.
   */
  const insertTemplate = useCallback(
    async (templatePath: string) => {
      setTemplatesOpen(false)
      const editor = getActiveEditor()
      const target = activePath
      if (editor === null || target === null) return

      const read = await api.invoke('fs:read', templatePath)
      if (!read.ok) return

      const name = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '')
      const text = fillTemplate(templateBody(read.content), {
        title: name,
        path: target,
        now: new Date(),
      })

      editor.run((state) => {
        const range = state.selection.main
        return {
          changes: { from: range.from, to: range.to, insert: text },
          selection: { anchor: range.from + text.length },
          scrollIntoView: true,
          userEvent: 'input.template',
        }
      })
    },
    [activePath],
  )

  // --- tidy ---------------------------------------------------------------
  const [tidy, setTidy] = useState<TidyPlan | null>(null)
  const [tidyBusy, setTidyBusy] = useState(false)

  /**
   * Build the plan, then show it. Nothing moves until the dialog is confirmed -
   * this rewrites links across the vault, and a reorganisation you did not get
   * to read first is one you cannot trust.
   */
  const openTidy = useCallback(async () => {
    const context = await api.invoke('index:context')
    setTidy(
      planTidy({
        notes: allNotes,
        folders: allFolders,
        context: new Map(context.map((entry) => [entry.path, { tags: entry.tags, links: entry.links }])),
        // The board owns one of these and templates are not notes you file;
        // a stray note landing in either would turn up where nobody put it.
        reserved: [CARD_FOLDER, CHAT_FOLDER, templates.settings.folder, templates.settings.daily.folder],
      }),
    )
  }, [allNotes, allFolders, templates.settings])

  const runTidy = useCallback(async () => {
    if (tidy === null) return
    setTidyBusy(true)
    // Create each new folder once, even when several notes are headed for it.
    const created = new Set<string>()
    for (const move of tidy.moves) {
      if (!move.creates || created.has(move.into)) continue
      created.add(move.into)
      await api.invoke('fs:create', '', move.into, 'folder')
    }
    for (const move of tidy.moves) {
      // `fs:move` is the same path as a drag in the tree, so links follow.
      await api.invoke('fs:move', move.path, move.into)
    }
    await refresh()
    noteIndexChanged()
    setTidyBusy(false)
    setTidy(null)
  }, [tidy, refresh])

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
      () => vimRef.current,
      () => showTitleRef.current,
    )
    registerUnresolvedView((p) => openFileRef.current(p))
    registerGraphView((p) => openFileRef.current(p))
    registerBoardView((p) => openBoardCardRef.current(p))
    registerChatView(
      () => appearanceRef.current.aiModel,
      (aiModel) => updateRef.current({ aiModel }),
    )
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

  /**
   * A card opens in the Tasks workspace, not in Data.
   *
   * Sending you to another section to read the task you just clicked would
   * throw away the board you were looking at - and it is the same editor either
   * way, because a card is a note.
   */
  const openBoardCard = useCallback(
    (path: string) => {
      sections?.tasks.openView('markdown', { path })
    },
    [sections],
  )

  // --- actions ------------------------------------------------------------

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
  /**
   * Read lazily by the markdown view, so the mode is current without the view
   * being re-registered every time it changes.
   */
  // Read lazily by the chat view, which is registered once but must always see
  // the current model and be able to change it.
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  const updateRef = useRef(update)
  updateRef.current = update

  const livePreviewRef = useRef(appearance.livePreview)
  livePreviewRef.current = appearance.livePreview
  const vimRef = useRef(appearance.vimMode)
  vimRef.current = appearance.vimMode
  const showTitleRef = useRef(appearance.showNoteTitle)
  showTitleRef.current = appearance.showNoteTitle

  /**
   * Save template settings, creating the templates folder if it is new.
   *
   * Created on save rather than on first use: the whole point of choosing a
   * folder is to go and put templates in it, and a folder that only appears
   * after the first template is one you cannot put the first template in.
   * Nothing is moved from the old folder - that would be a vault-wide rename
   * with link rewrites, which is not what "change a setting" should do.
   */
  const updateTemplates = useCallback(
    async (requested: TemplateSettings) => {
      /**
       * Match an existing folder regardless of case.
       *
       * The Mac disk is case-insensitive and the tree is not: typing
       * "Templates" beside an existing "templates" found nothing in the tree,
       * asked main to create it, and main - seeing the name taken on disk -
       * made "Templates 2". Adopting the folder's real spelling instead means
       * the setting points at the folder that is actually there.
       */
      const existing = [...tree.byPath.values()].find(
        (node) => node.kind === 'folder' && node.path.toLowerCase() === requested.folder.toLowerCase(),
      )
      const next = existing === undefined ? requested : { ...requested, folder: existing.path }
      const previous = templates.settings
      templates.update(next)

      if (existing === undefined) {
        const at = next.folder.lastIndexOf('/')
        await api.invoke('fs:create', at === -1 ? '' : next.folder.slice(0, at), next.folder.slice(at + 1), 'folder')
        await refresh()
      }
      if (await retemplateDailyNote(previous, next)) noteIndexChanged()
    },
    [templates, tree.byPath, refresh],
  )

  const openDailyNote = useCallback(async () => {
    const result = await ensureDailyNote(templates.settings)
    if (!result.ok) return
    if (result.created) {
      await refresh()
      noteIndexChanged()
    }
    openFileRef.current(result.path)
  }, [templates.settings, refresh])

  const settingsDepsRef = useRef({
    appearance,
    update,
    vault,
    onCloseVault,
    templates: templates.settings,
    updateTemplates: (_next: TemplateSettings) => {},
    notes: [] as string[],
    openDailyNote: () => {},
  })
  settingsDepsRef.current = {
    appearance,
    update,
    vault,
    onCloseVault,
    templates: templates.settings,
    updateTemplates: (next: TemplateSettings) => void updateTemplates(next),
    notes: allNotes,
    openDailyNote: () => void openDailyNote(),
  }

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

  const createAt = useCallback(
    async (parent: string, kind: 'file' | 'folder') => {
      const name = kind === 'file' ? 'Untitled.md' : 'New folder'
      const result = await api.invoke('fs:create', parent, name, kind)
      if (!result.ok) return
      await refresh()
      // Expand the folder it went into, or the new thing is created somewhere
      // you cannot see.
      if (parent !== '') setExpanded((prev) => new Set(prev).add(parent))
      if (kind === 'file') openFile(result.path)
      else setExpanded((prev) => new Set(prev).add(result.path))
    },
    [refresh, openFile],
  )

  const createIn = useCallback(
    (kind: 'file' | 'folder') => {
      const parent = activePath === null ? '' : activePath.slice(0, Math.max(0, activePath.lastIndexOf('/')))
      return createAt(parent, kind)
    },
    [activePath, createAt],
  )

  /** The sidebar's bottom-left button means something different per section. */
  const onNew = useCallback(() => {
    if (activeSection === 'data') {
      void createIn('file')
      return
    }
    if (activeSection === 'ai') {
      void newChat()
      return
    }
    if (activeSection === 'tasks') {
      // It used to open another copy of the board, which is not what a button
      // labelled "Task" promises. Now it makes a card on the board you are
      // looking at and opens it, so you can start typing.
      const board = boards.boards.find((entry) => entry.id === activeBoard) ?? boards.boards[0]
      const column = board?.columns[0]
      if (board === undefined || column === undefined) return
      void createCard(board.id, column.id, 'New task').then((created) => {
        if (created.ok) openBoardCard(created.path)
      })
      return
    }
    active?.openView(section.viewType, { draft: Date.now() }, { reuse: false })
  }, [activeSection, createIn, active, section.viewType, boards, activeBoard, openBoardCard, newChat])

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
      openSettings: () => setSettingsOpen(true),
      openTemplates: () => setTemplatesOpen(true),
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
      toggleHistory: () => setHistoryWindow({ open: !historyWindow.open }),
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
    historyWindow.open,
    setHistoryWindow,
    appearance.livePreview,
    openExtension,
  ])

  /**
   * The daily note, made automatically.
   *
   * Checked when the vault opens, when the setting changes, when the window
   * comes back into focus, and once a minute - and acted on only when the
   * calendar day has changed since the last check. So a laptop opened the next
   * morning gets its note within a minute without anyone doing anything, and
   * an app left running overnight rolls over at midnight.
   *
   * It creates the note; it does not open it. Taking over the editor on launch
   * would be the app deciding what you do first - "Open today's note" is one
   * command away for when you want it.
   */
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!templates.loaded || !templates.settings.daily.enabled) return
    let lastDay = ''
    let running = false
    const check = async (): Promise<void> => {
      const today = dayKey()
      if (today === lastDay || running) return
      running = true
      try {
        const result = await ensureDailyNote(templates.settings)
        if (result.ok) {
          lastDay = today
          if (result.created) {
            await refreshRef.current()
            noteIndexChanged()
          }
        }
      } finally {
        running = false
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 60_000)
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [templates.loaded, templates.settings])

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

  /**
   * A file dropped anywhere but the editor is dropped nowhere.
   *
   * Chromium's default for a file drop is to navigate to it, which in a
   * single-page app means the window replaces itself with the image you were
   * trying to file. The editor's own handler takes the drops that matter; this
   * swallows the misses.
   */
  useEffect(() => {
    const swallow = (ev: DragEvent): void => {
      if (ev.dataTransfer?.types.includes('Files') !== true) return
      ev.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

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
            onExpandAll={activeSection === 'data' ? () => setExpanded(new Set(allFolders)) : undefined}
            onCollapseAll={activeSection === 'data' ? () => setExpanded(new Set()) : undefined}
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
              />
            ) : activeSection === 'tasks' ? (
              <BoardList activeBoard={activeBoard} query={query} onOpen={openBoard} />
            ) : (
              <ChatList
                tree={tree.roots}
                activePath={activeChat}
                query={query}
                onOpen={openChat}
                onChanged={() => void refresh()}
              />
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

        {historyWindow.open && activePath !== null && (
          <FloatingWindow
            title={`History — ${activePath.slice(activePath.lastIndexOf('/') + 1).replace(/\.md$/, '')}`}
            geometry={historyWindow}
            onChange={setHistoryWindow}
            onClose={() => setHistoryWindow({ open: false })}
            closeHint="Close history"
          >
            <History
              path={activePath}
              // A restore rewrites the file; the editor picks that up through
              // the watcher, so nothing to do here but refresh the list.
              onRestored={() => void refresh()}
            />
          </FloatingWindow>
        )}

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
      {templatesOpen && (
        <TemplatePicker
          notes={allNotes}
          folder={templates.settings.folder}
          onPick={(path) => void insertTemplate(path)}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {themePicker !== null && (
        <SidebarThemePicker
          at={themePicker}
          appearance={appearance}
          update={update}
          onClose={() => setThemePicker(null)}
        />
      )}
      {settingsOpen && <SettingsDialog {...settingsDepsRef.current} onClose={() => setSettingsOpen(false)} />}
      {tidy !== null && (
        <TidyDialog
          plan={tidy}
          busy={tidyBusy}
          onConfirm={() => void runTidy()}
          onCancel={() => setTidy(null)}
        />
      )}
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
