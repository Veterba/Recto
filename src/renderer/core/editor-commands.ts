import * as md from '../editor/markdown-actions'
import { getActiveEditor } from '../views/MarkdownView'
import type { Command, CommandRegistry } from './commands'

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
    editorCommand('editor:highlight', 'Highlight', 'Mod+Shift+H', md.toggleHighlight),
    editorCommand('editor:checklist', 'Toggle checklist item', 'Mod+Shift+C', md.toggleChecklist),
    editorCommand('editor:bullet-list', 'Toggle bullet list', 'Mod+Shift+8', md.toggleBulletList),
    editorCommand('editor:numbered-list', 'Toggle numbered list', 'Mod+Shift+7', md.toggleNumberedList),
    editorCommand('editor:quote', 'Toggle blockquote', 'Mod+Shift+9', md.toggleQuote),
    editorCommand('editor:link', 'Insert link', 'Mod+K', md.insertLink),
    editorCommand('editor:wikilink', 'Insert wikilink', 'Mod+Shift+K', md.insertWikiLink),
    editorCommand('editor:code-block', 'Insert code block', 'Mod+Shift+E', md.insertCodeBlock),
    editorCommand('editor:horizontal-rule', 'Insert horizontal rule', 'Mod+Shift+Minus', md.insertHorizontalRule),
    // Alignment writes an HTML wrapper, which markdown has no syntax for.
    // Mod+Shift+L/E/R/J would collide with the theme cycle and inline code, so
    // these go on Mod+Alt, which is otherwise free.
    editorCommand('editor:align-left', 'Align left', 'Mod+Alt+ArrowLeft', (state) =>
      md.setAlignment(state, 'left'),
    ),
    editorCommand('editor:align-center', 'Align centre', 'Mod+Alt+ArrowUp', (state) =>
      md.setAlignment(state, 'center'),
    ),
    editorCommand('editor:align-right', 'Align right', 'Mod+Alt+ArrowRight', (state) =>
      md.setAlignment(state, 'right'),
    ),
    editorCommand('editor:align-justify', 'Justify', 'Mod+Alt+ArrowDown', (state) =>
      md.setAlignment(state, 'justify'),
    ),
    editorCommand('editor:move-line-up', 'Move line up', 'Alt+ArrowUp', (state) => md.moveLines(state, -1)),
    editorCommand('editor:move-line-down', 'Move line down', 'Alt+ArrowDown', (state) => md.moveLines(state, 1)),
    {
      id: 'editor:toggle-live-preview',
      name: 'Toggle Live Preview (show markdown syntax)',
      section: 'Editor',
      hotkey: 'Mod+Shift+P',
      isAvailable: () => getActiveEditor() !== null,
      run: () => onToggleLivePreview(),
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
