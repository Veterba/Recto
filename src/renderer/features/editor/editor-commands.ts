import { api } from '../../app/api'
import * as md from './markdown-actions'
import { HIGHLIGHT_COLOURS, setHighlightColour } from './highlights'
import { openHighlightPicker } from './components/HighlightPicker'
import { getActiveEditor } from './components/MarkdownView'
import { getActiveCodeEditor } from './components/CodeView'
import { convertHtmlTableAt } from './html-blocks'
import { inTable, insertTableSpec, runTableAction, TABLE_COMMANDS, type TableAction } from './table-editor'
import type { Command, CommandRegistry } from '../../app/commands'
import { toggleOutline } from './outline'
import { setFocusUnit, toggleAuthors, toggleFocus, toggleStyle, toggleSyntax, toggleTypewriter } from './writing-modes'
import { IPC } from '@shared/ipc'

/**
 * The editor shortcut set, as registry entries.
 *
 * Declared here as data rather than as a CodeMirror keymap so that one list
 * feeds the palette, the (future) menus and the hotkey editor. The editor is
 * reached through `getActiveEditor()`, and a command is simply unavailable when
 * no editor has focus - which is what stops ⌘⇧2 firing on the kanban board.
 */

/**
 * True only when a note actually has focus.
 *
 * Checking merely that an editor exists is not enough: the chord would then be
 * claimed by the editor while you were typing in the sidebar's search box.
 */
const editorHasFocus = (): boolean => inEditor() && document.activeElement?.closest('.cm-panels') === null

/**
 * Focus is in an editor, its find bar included. Only find wants the bar:
 * ⌘B there would bold the note while you were typing a query.
 */
const inEditor = (): boolean => {
  if (getActiveEditor() === null) return false
  const active = document.activeElement
  // A floating note window reads a note; the editor commands are for the one being written.
  // The code editor is a CodeMirror too, but markdown commands have no business there.
  // Nor in a table being edited: its cells take keys of their own (table-editor.ts).
  return active !== null && active.closest('.cm-editor') !== null && active.closest('.note-window, .code-view, .cm-tbl') === null
}

/** Wrap a markdown action as a command that runs against the live editor. */
function editorCommand(
  id: string,
  name: string,
  hotkey: string | undefined,
  action: Parameters<NonNullable<ReturnType<typeof getActiveEditor>>['run']>[0],
  section = 'Formatting',
): Command {
  return {
    id,
    name,
    section,
    scope: 'editor',
    ...(hotkey === undefined ? {} : { hotkey }),
    isAvailable: editorHasFocus,
    run: () => {
      getActiveEditor()?.run(action)
    },
  }
}

const TABLE_NAMES: Record<TableAction, [name: string, hotkey: string]> = {
  'row-up': ['Move row up', 'Alt+ArrowUp'],
  'row-down': ['Move row down', 'Alt+ArrowDown'],
  'column-left': ['Move column left', 'Alt+ArrowLeft'],
  'column-right': ['Move column right', 'Alt+ArrowRight'],
  'add-row-below': ['Add row below', 'Mod+Enter'],
}

/**
 * The table's own keys, as commands: listed and rebindable like any other.
 * The table reads them itself (TableController.onKeyDown), since it takes its
 * keys before the window does; from the palette they act on the table with focus.
 */
function tableCommands(): Command[] {
  return Object.entries(TABLE_COMMANDS).map(([id, action]) => ({
    id,
    name: TABLE_NAMES[action][0],
    section: 'Tables',
    scope: 'table' as const,
    hotkey: TABLE_NAMES[action][1],
    isAvailable: inTable,
    run: () => {
      runTableAction(action)
    },
  }))
}

export function registerEditorCommands(registry: CommandRegistry, onToggleLivePreview: () => void): () => void {
  const commands: Command[] = [
    // Headings: ⌘⌥1-6. Not ⌘⇧1-6: ⌘⇧3, 4 and 5 are macOS screenshots, which
    // the system takes before any app sees them.
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      editorCommand(`editor:heading-${level}`, `Heading ${level}`, `Mod+Alt+${level}`, (state) => md.toggleHeading(state, level)),
    ),
    editorCommand('editor:bold', 'Bold', 'Mod+B', md.toggleBold),
    editorCommand('editor:italic', 'Italic', 'Mod+I', md.toggleItalic),
    editorCommand('editor:inline-code', 'Inline code', 'Mod+E', md.toggleInlineCode),
    editorCommand('editor:strikethrough', 'Strikethrough', 'Mod+Shift+X', md.toggleStrikethrough),
    editorCommand('editor:insert-table', 'Insert table', 'Mod+Alt+T', (state) => insertTableSpec(state, 3, 3), 'Tables'),
    // A table pasted as HTML, made a markdown table: put the caret in it first.
    editorCommand('editor:convert-html-table', 'Convert HTML table to Markdown', undefined, convertHtmlTableAt, 'Tables'),
    // ⌘⇧H: a plain highlight on the selection, or off the highlight the caret is in.
    editorCommand('editor:highlight', 'Highlight', 'Mod+Shift+H', md.toggleHighlight),
    // ⌘⌥H: the colour picker (macOS's "Hide others" chord - the app takes it
    // while a note has focus, which is where this is used).
    {
      id: 'editor:highlight-picker',
      name: 'Highlight colour…',
      section: 'Formatting',
      scope: 'editor',
      hotkey: 'Mod+Alt+H',
      isAvailable: editorHasFocus,
      run: () => openHighlightPicker(),
    },
    // Each colour (==🔴…==, as Obsidian writes it) by name, from the palette.
    ...HIGHLIGHT_COLOURS.map((c) =>
      editorCommand(`editor:highlight-${c.id}`, `Highlight ${c.label.toLowerCase()}`, undefined, (state) =>
        setHighlightColour(state, c.id),
      ),
    ),
    // ⌘L, as in Obsidian.
    editorCommand('editor:checklist', 'Toggle checklist item', 'Mod+L', md.toggleChecklist),
    editorCommand('editor:bullet-list', 'Toggle bullet list', 'Mod+Shift+8', md.toggleBulletList),
    editorCommand('editor:numbered-list', 'Toggle numbered list', 'Mod+Shift+7', md.toggleNumberedList),
    editorCommand('editor:quote', 'Toggle blockquote', 'Mod+Shift+9', md.toggleQuote),
    editorCommand('editor:link', 'Insert link', 'Mod+K', md.insertLink),
    editorCommand('editor:wikilink', 'Insert wikilink', 'Mod+Shift+K', md.insertWikiLink),
    editorCommand('editor:code-block', 'Insert code block', 'Mod+Shift+E', md.insertCodeBlock),
    editorCommand('editor:math', 'Inline maths', 'Mod+Shift+M', md.toggleMath),
    editorCommand('editor:math-block', 'Maths block', 'Mod+Alt+M', md.insertMathBlock),
    editorCommand('editor:horizontal-rule', 'Insert horizontal rule', 'Mod+Shift+Minus', md.insertHorizontalRule),
    ...tableCommands(),
    editorCommand('editor:move-line-up', 'Move line up', 'Alt+ArrowUp', (state) => md.moveLines(state, -1), 'Editor'),
    editorCommand('editor:move-line-down', 'Move line down', 'Alt+ArrowDown', (state) => md.moveLines(state, 1), 'Editor'),
    {
      id: 'editor:image',
      name: 'Insert image',
      section: 'Formatting',
      scope: 'editor',
      hotkey: 'Mod+Shift+I',
      isAvailable: editorHasFocus,
      run: () => {
        const editor = getActiveEditor()
        if (editor === null) return
        void api.invoke(IPC.fsImportImages).then((result) => {
          if (!result.ok || result.paths.length === 0) return
          // One `![](...)` per file, on its own line, because two images on one
          // line render side by side in some readers and stacked in others.
          const markdown = result.paths.map((path) => `![${path.slice(path.lastIndexOf('/') + 1)}](${encodeURI(path)})`).join('\n')
          editor.run((state) => {
            const range = state.selection.main
            return {
              changes: { from: range.from, to: range.to, insert: markdown },
              selection: { anchor: range.from + markdown.length },
              scrollIntoView: true,
              userEvent: 'input.image',
            }
          })
        })
      },
    },
    {
      id: 'editor:toggle-live-preview',
      name: 'Toggle Live Preview (show markdown syntax)',
      section: 'Editor',
      hotkey: 'Mod+Shift+P',
      isAvailable: () => getActiveEditor() !== null,
      run: () => onToggleLivePreview(),
    },
    // --- writing tools, after iA Writer ---------------------------------------
    {
      id: 'writing:toggle-focus',
      name: 'Toggle focus mode',
      section: 'Writing',
      icon: 'focus',
      hotkey: 'Mod+Shift+Enter',
      isAvailable: () => getActiveEditor() !== null,
      run: toggleFocus,
    },
    ...(['line', 'sentence', 'paragraph'] as const).map((unit): Command => ({
      id: `writing:focus-${unit}`,
      name: `Focus on the current ${unit}`,
      section: 'Writing',
      run: () => setFocusUnit(unit),
    })),
    {
      id: 'writing:toggle-typewriter',
      name: 'Toggle typewriter scrolling',
      section: 'Writing',
      hotkey: 'Mod+Alt+Y',
      run: toggleTypewriter,
    },
    {
      id: 'writing:toggle-syntax',
      name: 'Toggle syntax highlight',
      section: 'Writing',
      icon: 'highlighter',
      hotkey: 'Mod+Alt+S',
      run: toggleSyntax,
    },
    {
      id: 'writing:toggle-style',
      name: 'Toggle style check',
      section: 'Writing',
      icon: 'strikethrough',
      hotkey: 'Mod+Alt+C',
      run: toggleStyle,
    },
    {
      id: 'writing:toggle-authors',
      name: 'Show or hide authors',
      section: 'Writing',
      icon: 'user-round',
      hotkey: 'Mod+Alt+A',
      run: toggleAuthors,
    },
    ...(
      [
        ['human', 'Mark selection as written by me'],
        ['ai', 'Mark selection as written by AI'],
        ['reference', 'Mark selection as reference'],
      ] as const
    ).map(([author, name]): Command => ({
      id: `writing:mark-${author}`,
      name,
      section: 'Writing',
      isAvailable: () => getActiveEditor() !== null,
      run: () => {
        getActiveEditor()?.markSelection(author)
      },
    })),
    ...(
      [
        // Not ⌘⌥⇧V: that is the app menu's Paste and Match Style.
        ['ai', 'Paste as AI text', 'Mod+Alt+V'],
        ['reference', 'Paste as reference', undefined],
      ] as const
    ).map(([author, name, hotkey]): Command => ({
      id: `writing:paste-${author}`,
      name,
      section: 'Writing',
      scope: 'editor',
      ...(hotkey === undefined ? {} : { hotkey }),
      isAvailable: editorHasFocus,
      run: () => {
        void api.invoke(IPC.appClipboardText).then((text) => {
          if (text !== '') getActiveEditor()?.insertAs(author, text)
        })
      },
    })),
    {
      id: 'editor:toggle-fold',
      name: 'Toggle fold on current line',
      section: 'Editor',
      scope: 'editor',
      hotkey: 'Mod+.',
      isAvailable: editorHasFocus,
      run: () => {
        getActiveEditor()?.toggleFold()
      },
    },
    {
      id: 'editor:fold-all',
      name: 'Fold all headings and lists',
      section: 'Editor',
      hotkey: 'Mod+Alt+[',
      isAvailable: () => getActiveEditor() !== null,
      run: () => getActiveEditor()?.foldAll(),
    },
    {
      id: 'editor:unfold-all',
      name: 'Unfold all headings and lists',
      section: 'Editor',
      hotkey: 'Mod+Alt+]',
      isAvailable: () => getActiveEditor() !== null,
      run: () => getActiveEditor()?.unfoldAll(),
    },
    {
      id: 'editor:toggle-outline',
      name: 'Toggle outline',
      section: 'Editor',
      hotkey: 'Mod+Shift+O',
      isAvailable: () => getActiveEditor() !== null,
      run: toggleOutline,
    },
    {
      id: 'editor:save',
      name: 'Save now',
      section: 'Editor',
      scope: 'editor',
      hotkey: 'Mod+S',
      isAvailable: editorHasFocus,
      run: () => getActiveEditor()?.save(),
    },
    {
      id: 'editor:find',
      name: 'Find in note',
      section: 'Editor',
      scope: 'editor',
      hotkey: 'Mod+F',
      isAvailable: () => inEditor() || getActiveCodeEditor() !== null,
      run: () => (getActiveCodeEditor() ?? getActiveEditor())?.openFind(false),
    },
    {
      id: 'editor:replace',
      name: 'Find and replace in note',
      section: 'Editor',
      scope: 'editor',
      hotkey: 'Mod+Alt+F',
      isAvailable: () => inEditor() || getActiveCodeEditor() !== null,
      run: () => (getActiveCodeEditor() ?? getActiveEditor())?.openFind(true),
    },
  ]

  return registry.registerAll(commands)
}
