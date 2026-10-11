import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createElement } from 'react'
import { openLayer } from '../../../ui/menu-host'
import { Icon } from '../../../ui/Icon'
import { HIGHLIGHT_COLOURS, highlightAt, setHighlightColour, toggleHighlight, type HighlightColour } from '../highlights'
import { getActiveEditor } from './MarkdownView'

/**
 * The highlight colour picker (⌘⌥H, and the toolbar's colour chevron): the six
 * colours Obsidian writes (==🔴…==), Default and Remove highlight, on the
 * shared glass surface, just above the selection - or above the highlight the
 * caret is in. The colour in force has a check.
 *
 * Keys: 1–6 a colour, 0 default, Backspace removes, arrows and Enter, Esc
 * closes. A choice applies at once, as one undo step, and closes the picker:
 * on plain text it wraps (==🔵text==), on a highlight it changes only the
 * emoji, and Remove unwraps.
 */

type Choice = HighlightColour | 'default' | 'remove'
type Anchor = { left: number; top: number; bottom: number }

const CHOICES: readonly Choice[] = [...HIGHLIGHT_COLOURS.map((c) => c.id), 'default', 'remove']

/** Open the picker for the note being edited. `anchor`: a toolbar button to sit under, instead of above the text. */
export function openHighlightPicker(anchor?: DOMRect): void {
  const editor = getActiveEditor()
  if (editor === null) return
  const state = editor.getState()
  const range = state.selection.main
  const existing = highlightAt(state, range.from, range.to)
  let at: Anchor | null = null
  let below = false
  if (anchor !== undefined) {
    at = { left: anchor.left, top: anchor.top, bottom: anchor.bottom }
    below = true
  } else {
    const coords = editor.coordsAt(range.empty && existing !== null ? existing.from : range.from)
    if (coords !== null) at = coords
  }
  if (at === null) return
  const current: Choice | null = existing === null ? null : (existing.colour ?? 'default')
  const anchorAt = at
  openLayer((close) =>
    createElement(Picker, {
      at: anchorAt,
      below,
      current,
      canRemove: existing !== null,
      onPick: (choice: Choice) => {
        close()
        editor.run((s) => {
          if (choice === 'remove') return highlightAt(s, s.selection.main.from, s.selection.main.to) === null ? null : toggleHighlight(s)
          return setHighlightColour(s, choice === 'default' ? null : choice)
        })
        editor.focus()
      },
      onClose: () => {
        close()
        editor.focus()
      },
    }),
  )
}

function Picker({
  at,
  below,
  current,
  canRemove,
  onPick,
  onClose,
}: {
  at: Anchor
  below: boolean
  current: Choice | null
  canRemove: boolean
  onPick: (choice: Choice) => void
  onClose: () => void
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: at.left, top: at.top })
  const [focus, setFocus] = useState(Math.max(0, current === null ? 0 : CHOICES.indexOf(current)))

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const left = Math.max(8, Math.min(at.left, window.innerWidth - el.offsetWidth - 8))
    const above = at.top - el.offsetHeight - 6
    const top = below || above < 8 ? at.bottom + 6 : above
    setPosition({ left, top })
    el.focus()
  }, [at, below])

  useEffect(() => {
    const outside = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node) !== true) onClose()
    }
    window.addEventListener('mousedown', outside, true)
    return () => window.removeEventListener('mousedown', outside, true)
  }, [onClose])

  const enabled = (choice: Choice): boolean => choice !== 'remove' || canRemove
  const move = (step: number): void => {
    let next = focus
    for (let i = 0; i < CHOICES.length; i++) {
      next = (next + step + CHOICES.length) % CHOICES.length
      if (enabled(CHOICES[next]!)) break
    }
    setFocus(next)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const stop = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    const digit = /^[0-6]$/.test(event.key) ? Number(event.key) : null
    if (digit !== null && !event.metaKey && !event.ctrlKey && !event.altKey) {
      stop()
      onPick(digit === 0 ? 'default' : HIGHLIGHT_COLOURS[digit - 1]!.id)
      return
    }
    switch (event.key) {
      case 'Backspace':
      case 'Delete':
        stop()
        if (canRemove) onPick('remove')
        return
      case 'ArrowRight':
      case 'ArrowDown':
        stop()
        move(1)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
        stop()
        move(-1)
        return
      case 'Enter':
      case ' ':
        stop()
        onPick(CHOICES[focus]!)
        return
      case 'Escape':
        stop()
        onClose()
        return
      case 'Tab':
        stop()
        move(event.shiftKey ? -1 : 1)
    }
  }

  const item = (choice: Choice, index: number): React.ReactElement => {
    const colour = HIGHLIGHT_COLOURS.find((c) => c.id === choice)
    const label = colour !== undefined ? colour.label : choice === 'default' ? 'Default' : 'Remove highlight'
    const key = colour !== undefined ? String(index + 1) : choice === 'default' ? '0' : '⌫'
    const isCurrent = current === choice
    return (
      <button
        key={choice}
        className={`hl-pick__item${colour === undefined ? ' hl-pick__item--text' : ''}${focus === index ? ' is-focused' : ''}`}
        aria-label={colour !== undefined ? `Highlight ${colour.label.toLowerCase()}` : label}
        aria-pressed={choice === 'remove' ? undefined : isCurrent}
        title={`${label} (${key})`}
        disabled={!enabled(choice)}
        tabIndex={-1}
        onMouseEnter={() => setFocus(index)}
        onMouseDown={(event) => {
          event.preventDefault()
          onPick(choice)
        }}
      >
        {colour !== undefined ? (
          <span className={`hl-pick__swatch cm-highlight cm-highlight--${colour.id}`}>{isCurrent && <Icon name="check" size={12} />}</span>
        ) : (
          <>
            <span className={`hl-pick__mark${choice === 'default' ? ' cm-highlight' : ''}`}>
              {choice === 'remove' ? <Icon name="eraser" size={12} /> : isCurrent ? <Icon name="check" size={12} /> : null}
            </span>
            <span className="hl-pick__label">{label}</span>
            <kbd className="hl-pick__key">{key}</kbd>
          </>
        )}
      </button>
    )
  }

  return (
    <div
      ref={ref}
      className="hl-pick glass-surface"
      role="dialog"
      aria-label="Highlight colour"
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
    >
      <div className="hl-pick__swatches">{HIGHLIGHT_COLOURS.map((c, i) => item(c.id, i))}</div>
      <div className="hl-pick__rows">
        {item('default', 6)}
        {item('remove', 7)}
      </div>
    </div>
  )
}
