import { useEffect, useRef, useState } from 'react'
import { formatChord } from '../core/hotkeys'
import { commands } from '../core/commands'
import { toggleFocus } from '../core/writing'
import type { Format } from '../editor/markdown-actions'
import { FormatBar } from './FormatBar'
import { Icon } from './Icon'
import { Tip } from './Tip'
import { WritingButtons } from './WritingButtons'

/**
 * The toolbar in focus mode: hidden, and brought back by moving the pointer to
 * the top of the window - formatting on the left, a word count, and the way
 * out on the right.
 *
 * It follows the pointer rather than a hover target, because in focus mode
 * there is nothing at the top of the window to hover.
 */

/**
 * Measured from the top of the window. The title bar is a window-drag area,
 * and macOS delivers no pointer events over one - so the reveal zone reaches
 * below it, and the bar itself sits below it, or its buttons would be under
 * the drag area and clicks on them would move the window instead.
 */
const REVEAL_Y = 96
const HIDE_Y = 190
const HIDE_DELAY_MS = 450

/** Words in the note's body: frontmatter, markdown markers and link syntax do not count. */
export function countWords(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/, '')
  const words = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => ` ${alias ?? target} `)
    .replace(/[#>*_`~=[\]()|-]+/g, ' ')
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)
  return words?.length ?? 0
}

export function FocusBar({
  active,
  text,
  onAfter,
}: {
  active: ReadonlySet<Format>
  text: string
  onAfter?: (() => void) | undefined
}): React.ReactElement {
  const [shown, setShown] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      if (event.clientY <= REVEAL_Y) {
        window.clearTimeout(hideTimer.current)
        hideTimer.current = undefined
        setShown(true)
      } else if (event.clientY > HIDE_Y && hideTimer.current === undefined && !pinnedRef.current) {
        hideTimer.current = window.setTimeout(() => {
          hideTimer.current = undefined
          setShown(false)
        }, HIDE_DELAY_MS)
      }
    }
    // Leaving the window over the top edge keeps it; typing hides it again.
    const type = (): void => {
      if (!pinnedRef.current) setShown(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', type)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', type)
      window.clearTimeout(hideTimer.current)
    }
  }, [])

  const words = countWords(text)
  const binding = commands.bindingFor('writing:toggle-focus')

  return (
    <div className={`focusbar${shown || pinned ? ' is-shown' : ''}`} aria-hidden={!(shown || pinned)}>
      <FormatBar
        active={active}
        onRun={(id) => {
          void commands.run(id)
          onAfter?.()
        }}
        shortcutFor={(id) => {
          const chord = commands.bindingFor(id)
          return chord === null ? null : formatChord(chord)
        }}
        trailing={
          <>
            <WritingButtons onAfter={onAfter} onMenuChange={setPinned} menuPlacement="edge" />
            <span className="focusbar__sep" />
            <span className="focusbar__count">
              {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 230))} min
            </span>
            <Tip label="Leave focus mode" hint={binding === null ? undefined : formatChord(binding)}>
              <button className="focusbar__exit" onMouseDown={(event) => event.preventDefault()} onClick={toggleFocus}>
                <Icon name="log-out" size={14} />
                <span>Exit focus</span>
              </button>
            </Tip>
          </>
        }
      />
    </div>
  )
}
