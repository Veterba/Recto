import { Icon } from './Icon'
import type { Format } from '../editor/markdown-actions'

/**
 * The formatting toolbar.
 *
 * Every button runs a command from the registry by id - it is not a second set
 * of editing code. So a button, its keyboard shortcut and its palette entry can
 * never disagree, and the shortcut shows in the tooltip.
 *
 * Buttons light up when the format applies at the cursor, which is what makes a
 * toolbar usable without knowing the shortcuts: you can see what you are in.
 */

type Item =
  | { kind: 'sep' }
  | {
      kind: 'button'
      commandId: string
      label: string
      /** Text glyph for the headings, where an icon reads worse than "H1". */
      text?: string
      icon?: string
      /** Which active format lights this button up. */
      format?: Format
    }

const ITEMS: readonly Item[] = [
  { kind: 'button', commandId: 'editor:heading-1', label: 'Heading 1', text: 'H1', format: 'heading-1' },
  { kind: 'button', commandId: 'editor:heading-2', label: 'Heading 2', text: 'H2', format: 'heading-2' },
  { kind: 'button', commandId: 'editor:heading-3', label: 'Heading 3', text: 'H3', format: 'heading-3' },
  { kind: 'sep' },
  { kind: 'button', commandId: 'editor:bold', label: 'Bold', icon: 'bold', format: 'bold' },
  { kind: 'button', commandId: 'editor:italic', label: 'Italic', icon: 'italic', format: 'italic' },
  { kind: 'button', commandId: 'editor:strikethrough', label: 'Strikethrough', icon: 'strikethrough', format: 'strikethrough' },
  { kind: 'button', commandId: 'editor:highlight', label: 'Highlight', icon: 'highlighter', format: 'highlight' },
  { kind: 'button', commandId: 'editor:inline-code', label: 'Inline code', icon: 'code', format: 'code' },
  { kind: 'sep' },
  { kind: 'button', commandId: 'editor:link', label: 'Link', icon: 'link' },
  { kind: 'button', commandId: 'editor:wikilink', label: 'Wikilink', icon: 'brackets' },
  { kind: 'sep' },
  { kind: 'button', commandId: 'editor:bullet-list', label: 'Bullet list', icon: 'list', format: 'bullet' },
  { kind: 'button', commandId: 'editor:numbered-list', label: 'Numbered list', icon: 'list-ordered', format: 'numbered' },
  { kind: 'button', commandId: 'editor:checklist', label: 'Checklist', icon: 'list-checks', format: 'task' },
  { kind: 'button', commandId: 'editor:quote', label: 'Quote', icon: 'quote', format: 'quote' },
  { kind: 'sep' },
  { kind: 'button', commandId: 'editor:code-block', label: 'Code block', icon: 'square-code' },
  { kind: 'button', commandId: 'editor:horizontal-rule', label: 'Divider', icon: 'minus' },
]

type Props = {
  active: ReadonlySet<Format>
  /** Runs a registry command by id and returns focus to the editor. */
  onRun: (commandId: string) => void
  /** Keyboard shortcut for a command, for the tooltip. */
  shortcutFor: (commandId: string) => string | null
}

export function FormatBar({ active, onRun, shortcutFor }: Props): React.ReactElement {
  return (
    <div className="formatbar" role="toolbar" aria-label="Formatting">
      {ITEMS.map((item, i) => {
        if (item.kind === 'sep') return <span key={`sep-${i}`} className="formatbar__sep" aria-hidden="true" />

        const isActive = item.format !== undefined && active.has(item.format)
        const shortcut = shortcutFor(item.commandId)

        return (
          <button
            key={item.commandId}
            className={`formatbar__btn${isActive ? ' is-active' : ''}${item.text === undefined ? '' : ' formatbar__btn--text'}`}
            title={shortcut === null ? item.label : `${item.label} (${shortcut})`}
            aria-label={item.label}
            aria-pressed={item.format === undefined ? undefined : isActive}
            // mousedown, not click: the editor must not lose its selection
            // before the command reads it.
            onMouseDown={(ev) => {
              ev.preventDefault()
              onRun(item.commandId)
            }}
          >
            {item.text !== undefined ? item.text : <Icon name={item.icon ?? ''} size={15} />}
          </button>
        )
      })}
    </div>
  )
}
