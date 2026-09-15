import { useEffect, useRef, useState } from 'react'
import { commands } from '../core/commands'
import { formatChord } from '../core/hotkeys'
import { toggleFocus, useWriting } from '../core/writing'
import { Icon } from './Icon'
import { Tip } from './Tip'
import { WritingMenu } from './WritingMenu'

/**
 * Focus mode and the writing tools menu, as two toolbar buttons.
 *
 * One component for both toolbars - the note's own and the focus bar - so the
 * buttons are the same buttons wherever they appear.
 */
export function WritingButtons({
  onAfter,
  onMenuChange,
  menuPlacement = 'anchor',
}: {
  /** Where the menu opens: under the button, or against the window's right edge. */
  menuPlacement?: 'anchor' | 'edge'
  /** After a button acts: usually, give the editor its focus back. */
  onAfter?: (() => void) | undefined
  /** The focus bar stays out while the menu is open. */
  onMenuChange?: (open: boolean) => void
}): React.ReactElement {
  const writing = useWriting()
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const toolsButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => onMenuChange?.(menu !== null), [menu, onMenuChange])
  const focusKey = commands.bindingFor('writing:toggle-focus')

  return (
    <>
      <Tip label={writing.focus ? 'Leave focus mode' : 'Focus mode'} hint={focusKey === null ? undefined : `${formatChord(focusKey)} · Esc to leave`}>
        <button
          className={`formatbar__btn${writing.focus ? ' is-active' : ''}`}
          aria-label="Focus mode"
          aria-pressed={writing.focus}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            toggleFocus()
            onAfter?.()
          }}
        >
          <Icon name="focus" size={15} />
        </button>
      </Tip>
      <Tip label="Writing tools" hint="Focus, syntax, style check, authors">
        <button
          ref={toolsButton}
          className={`formatbar__btn${menu !== null || writing.syntax.on || writing.style.on ? ' is-active' : ''}`}
          aria-label="Writing tools"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => setMenu(menu === null ? event.currentTarget.getBoundingClientRect() : null)}
        >
          <Icon name="pen-line" size={15} />
        </button>
      </Tip>
      {menu !== null && (
        <WritingMenu
          anchor={menu}
          trigger={toolsButton.current}
          placement={menuPlacement}
          onClose={() => setMenu(null)}
          onOpenSettings={() => {
            setMenu(null)
            void commands.run('app:settings')
          }}
        />
      )}
    </>
  )
}
