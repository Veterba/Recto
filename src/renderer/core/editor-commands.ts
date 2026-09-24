import { api } from '../api'
import * as md from '../editor/markdown-actions'
import { getActiveEditor } from '../views/MarkdownView'
import type { Command, CommandRegistry } from './commands'
import { toggleOutline } from './outline'
import { setFocusUnit, toggleAuthors, toggleFocus, toggleStyle, toggleSyntax, toggleTypewriter } from './writing'

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
const editorHasFocus = (): boolean => {
  if (getActiveEditor() === null) return false
  const active = document.activeElement
  return active !== null && active.closest('.cm-editor') !== null
}

/** Wrap a markdown action as a command that runs against the live editor. */
function editorCommand(
  id: string,
  name: string,
  hotkey: string | undefined,
  action: Parameters<NonNullable<ReturnType<typeof getActiveEditor>>['run']>[0],
): Command {
  return {
    id,
    name,
    section: 'Editor',
    scope: 'editor',
    ...(hotkey === undefined ? {} : { hotkey }),
    isAvailable: editorHasFocus,
    run: () => {
      getActiveEditor()?.run(action)
    },
  }
}

export function registerEditorCommands(
  registry: CommandRegistry,
  onToggleLivePreview: () => void,
): () => void {
  const commands: Command[] = [
    // Headings: Mod+Shift+1..6, matching the request.
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      editorCommand(
        `editor:heading-${level}`,
        `Heading ${level}`,
        `Mod+Shift+${level}`,
        (state) => md.toggleHeading(state, level),
      ),
    ),
    editorCommand('editor:bold', 'Bold', 'Mod+B', md.toggleBold),
    editorCommand('editor:italic', 'Italic', 'Mod+I', md.toggleItalic),
    editorCommand('editor:inline-code', 'Inline code', 'Mod+E', md.toggleInlineCode),
    editorCommand('editor:strikethrough', 'Strikethrough', 'Mod+Shift+X', md.toggleStrikethrough),
    // Mod+Alt+H, not Mod+Shift+H: the home overlay took that, and an
    // editor-scoped binding wins whenever a note has focus - which would have
    // made the overlay unreachable from the place you spend all your time. The
    // letter is the part worth keeping.
    editorCommand('editor:highlight', 'Highlight', 'Mod+Alt+H', md.toggleHighlight),
    editorCommand('editor:checklist', 'Toggle checklist item', 'Mod+Shift+C', md.toggleChecklist),
    editorCommand('editor:bullet-list', 'Toggle bullet list', 'Mod+Shift+8', md.toggleBulletList),
    editorCommand('editor:numbered-list', 'Toggle numbered list', 'Mod+Shift+7', md.toggleNumberedList),
    editorCommand('editor:quote', 'Toggle blockquote', 'Mod+Shift+9', md.toggleQuote),
    editorCommand('editor:link', 'Insert link', 'Mod+K', md.insertLink),
    editorCommand('editor:wikilink', 'Insert wikilink', 'Mod+Shift+K', md.insertWikiLink),
    editorCommand('editor:code-block', 'Insert code block', 'Mod+Shift+E', md.insertCodeBlock),
    editorCommand('editor:math', 'Inline maths', 'Mod+Shift+M', md.toggleMath),
    editorCommand('editor:math-block', 'Maths block', 'Mod+Alt+M', md.insertMathBlock),
    editorCommand('editor:horizontal-rule', 'Insert horizontal rule', 'Mod+Shift+Minus', md.insertHorizontalRule),
    editorCommand('editor:move-line-up', 'Move line up', 'Alt+ArrowUp', (state) => md.moveLines(state, -1)),
    editorCommand('editor:move-line-down', 'Move line down', 'Alt+ArrowDown', (state) => md.moveLines(state, 1)),
    {
      id: 'editor:image',
      name: 'Insert image',
      section: 'Editor',
      scope: 'editor',
      hotkey: 'Mod+Shift+I',
      isAvailable: editorHasFocus,
      run: () => {
        const editor = getActiveEditor()
        if (editor === null) return
        void api.invoke('fs:import-images').then((result) => {
          if (!result.ok || result.paths.length === 0) return
          // One `![](...)` per file, on its own line, because two images on one
          // line render side by side in some readers and stacked in others.
          const markdown = result.paths
            .map((path) => `![${path.slice(path.lastIndexOf('/') + 1)}](${encodeURI(path)})`)
            .join('\n')
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
    ...(['line', 'sentence', 'paragraph'] as const).map(
      (unit): Command => ({
        id: `writing:focus-${unit}`,
        name: `Focus on the current ${unit}`,
        section: 'Writing',
        run: () => setFocusUnit(unit),
      }),
    ),
    { id: 'writing:toggle-typewriter', name: 'Toggle typewriter scrolling', section: 'Writing', hotkey: 'Mod+Alt+T', run: toggleTypewriter },
    { id: 'writing:toggle-syntax', name: 'Toggle syntax highlight', section: 'Writing', icon: 'highlighter', hotkey: 'Mod+Alt+S', run: toggleSyntax },
    { id: 'writing:toggle-style', name: 'Toggle style check', section: 'Writing', icon: 'strikethrough', hotkey: 'Mod+Alt+C', run: toggleStyle },
    { id: 'writing:toggle-authors', name: 'Show or hide authors', section: 'Writing', icon: 'user-round', hotkey: 'Mod+Alt+A', run: toggleAuthors },
    ...([
      ['human', 'Mark selection as written by me'],
      ['ai', 'Mark selection as written by AI'],
      ['reference', 'Mark selection as reference'],
    ] as const).map(
      ([author, name]): Command => ({
        id: `writing:mark-${author}`,
        name,
        section: 'Writing',
        isAvailable: () => getActiveEditor() !== null,
        run: () => {
          getActiveEditor()?.markSelection(author)
        },
      }),
    ),
    ...([
      // Not ⌘⌥⇧V: that is the app menu's Paste and Match Style.
      ['ai', 'Paste as AI text', 'Mod+Alt+V'],
      ['reference', 'Paste as reference', undefined],
    ] as const).map(
      ([author, name, hotkey]): Command => ({
        id: `writing:paste-${author}`,
        name,
        section: 'Writing',
        scope: 'editor',
        ...(hotkey === undefined ? {} : { hotkey }),
        isAvailable: editorHasFocus,
        run: () => {
          void api.invoke('app:clipboard-text').then((text) => {
            if (text !== '') getActiveEditor()?.insertAs(author, text)
          })
        },
      }),
    ),
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
      isAvailable: editorHasFocus,
      run: () => getActiveEditor()?.openSearch(),
    },
  ]

  return registry.registerAll(commands)
}
