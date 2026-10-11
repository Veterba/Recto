import { useEffect, useRef, useState } from 'react'
import { commands } from '../../../app/commands'
import { formatChord } from '../../../app/hotkeys'
import { toggleFocus, useWriting } from '../writing-modes'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { WritingMenu } from './WritingMenu'

/**
 * Focus mode and the writing tools menu, as two buttons.
 *
 * One component for both places - the status bar and the focus bar - so the
 * buttons are the same buttons wherever they appear.
 */
export function WritingButtons({
  onAfter,
  onMenuChange,
  menuPlacement = 'anchor',
  buttonClass = 'formatbar__btn',
  iconSize = 15,
}: {
  /** Where the menu opens: under the button, above it, or against the window's right edge. */
  menuPlacement?: 'anchor' | 'above' | 'edge'
  /** The look of the buttons where they sit. */
  buttonClass?: string
  iconSize?: number
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
  const tip = menuPlacement === 'above' ? 'top' : undefined
  // The tools' own shortcuts, so the tooltip teaches them.
  const toolKeys = (
    [
      ['writing:toggle-typewriter', 'typewriter'],
      ['writing:toggle-syntax', 'syntax'],
      ['writing:toggle-style', 'style'],
      ['writing:toggle-authors', 'authors'],
    ] as const
  )
    .map(([id, name]) => {
      const key = commands.bindingFor(id)
      return key === null ? null : `${name} ${formatChord(key)}`
    })
    .filter((k) => k !== null)

  return (
    <>
      <Tip
        label={writing.focus ? 'Leave focus mode' : 'Focus mode'}
        hint={focusKey === null ? undefined : `${formatChord(focusKey)} · Esc to leave`}
        placement={tip}
      >
        <button
          className={`${buttonClass}${writing.focus ? ' is-active' : ''}`}
          aria-label="Focus mode"
          aria-pressed={writing.focus}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            toggleFocus()
            onAfter?.()
          }}
        >
          <Icon name="focus" size={iconSize} />
        </button>
      </Tip>
      <Tip
        label="Writing tools"
        hint={toolKeys.length === 0 ? 'Focus, syntax, style check, authors' : toolKeys.join(' · ')}
        placement={tip}
        wrap
      >
        <button
          ref={toolsButton}
          className={`${buttonClass}${menu !== null || writing.syntax.on || writing.style.on ? ' is-active' : ''}`}
          aria-label="Writing tools"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => setMenu(menu === null ? event.currentTarget.getBoundingClientRect() : null)}
        >
          <Icon name="pen-line" size={iconSize} />
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
