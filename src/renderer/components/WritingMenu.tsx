import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatChord } from '../core/hotkeys'
import { commands } from '../core/commands'
import {
  setFocusUnit,
  toggleAuthors,
  toggleFocus,
  toggleStyle,
  toggleSyntax,
  toggleTypewriter,
  updateWriting,
  useWriting,
  type WritingSettings,
} from '../core/writing'
import { Icon } from './Icon'

/**
 * iA Writer's View menu, as a popover: focus, syntax, style, authors.
 *
 * Laid out the way iA lays it out, because it is a good layout: each section
 * opens with its master switch, and the options under it stay visible and
 * editable while the switch is off, so you can choose what to highlight before
 * turning highlighting on.
 */

type Props = {
  anchor: DOMRect
  /** The button that opened it: a press on it is the button's to handle, not a click outside. */
  trigger?: HTMLElement | null
  /** `edge`: against the right side of the window, for focus mode where the text is centred. */
  placement?: 'anchor' | 'edge'
  onClose: () => void
  onOpenSettings?: () => void
}

const shortcut = (id: string): string => {
  const binding = commands.bindingFor(id)
  return binding === null ? '' : formatChord(binding)
}

function Master({ icon, label, on, onClick, command }: { icon: string; label: string; on: boolean; onClick: () => void; command: string }): React.ReactElement {
  return (
    <button className={`wmenu__master${on ? ' is-on' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={onClick}>
      <Icon name={icon} size={15} />
      <span className="wmenu__label">{label}</span>
      <span className="wmenu__state">{on ? 'On' : 'Off'}</span>
      <kbd className="wmenu__key">{shortcut(command)}</kbd>
    </button>
  )
}

function Check({ label, on, onClick, colour, radio = false }: { label: string; on: boolean; onClick: () => void; colour?: string; radio?: boolean }): React.ReactElement {
  return (
    <button className="wmenu__item" role={radio ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={on} onClick={onClick}>
      <span className="wmenu__tick">{on ? <Icon name="check" size={13} /> : null}</span>
      <span className="wmenu__label" style={colour === undefined ? undefined : { color: colour }}>
        {label}
      </span>
    </button>
  )
}

const flip = <K extends 'syntax' | 'style' | 'authors'>(section: K, key: keyof WritingSettings[K]) => (): void =>
  updateWriting((s) => ({ ...s, [section]: { ...s[section], [key]: !s[section][key] } }))

export function WritingMenu({ anchor, trigger, placement = 'anchor', onClose, onOpenSettings }: Props): React.ReactElement {
  const writing = useWriting()
  const card = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState<{ left: number; top: number; maxHeight?: number }>({ left: anchor.right, top: anchor.bottom + 6 })

  useLayoutEffect(() => {
    const element = card.current
    if (element === null) return
    const left =
      placement === 'edge'
        ? window.innerWidth - element.offsetWidth - 16
        : Math.min(anchor.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8)
    // Always below the button, never moved up over it: a menu nudged up to fit a
    // short window covered its own button, so the click meant to close it
    // landed on the menu instead. It scrolls inside when there is no room.
    const top = anchor.bottom + (placement === 'edge' ? 10 : 6)
    setAt({ left: Math.max(8, left), top, maxHeight: Math.max(160, window.innerHeight - top - 8) })
  }, [anchor, placement])

  useEffect(() => {
    const opened = Date.now()
    const down = (event: MouseEvent): void => {
      if (Date.now() - opened < 200) return
      if (card.current?.contains(event.target as Node) === true) return
      // Closing here as well as in the button's own click reopened the menu:
      // mousedown closed it, then the click saw it closed and opened it again.
      if (trigger?.contains(event.target as Node) === true) return
      onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose, trigger])

  return createPortal(
    <div
      className={`wmenu${placement === 'edge' ? ' wmenu--edge' : ''}`}
      ref={card}
      role="menu"
      aria-label="Writing tools"
      style={at}
      // Keep the editor's selection: marking authorship acts on it.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Master icon="focus" label="Focus mode" on={writing.focus} onClick={toggleFocus} command="writing:toggle-focus" />
      <Check radio label="Line" on={writing.focusUnit === 'line'} onClick={() => setFocusUnit('line')} />
      <Check radio label="Sentence" on={writing.focusUnit === 'sentence'} onClick={() => setFocusUnit('sentence')} />
      <Check radio label="Paragraph" on={writing.focusUnit === 'paragraph'} onClick={() => setFocusUnit('paragraph')} />
      <Check label="Typewriter — keep the line centred" on={writing.typewriter} onClick={toggleTypewriter} />

      <span className="wmenu__sep" />
      <Master icon="highlighter" label="Syntax highlight" on={writing.syntax.on} onClick={toggleSyntax} command="writing:toggle-syntax" />
      <Check label="Adjectives" colour="var(--pos-adjective)" on={writing.syntax.adjectives} onClick={flip('syntax', 'adjectives')} />
      <Check label="Nouns" colour="var(--pos-noun)" on={writing.syntax.nouns} onClick={flip('syntax', 'nouns')} />
      <Check label="Adverbs" colour="var(--pos-adverb)" on={writing.syntax.adverbs} onClick={flip('syntax', 'adverbs')} />
      <Check label="Verbs" colour="var(--pos-verb)" on={writing.syntax.verbs} onClick={flip('syntax', 'verbs')} />
      <Check label="Conjunctions" colour="var(--pos-conjunction)" on={writing.syntax.conjunctions} onClick={flip('syntax', 'conjunctions')} />

      <span className="wmenu__sep" />
      <Master icon="strikethrough" label="Style check" on={writing.style.on} onClick={toggleStyle} command="writing:toggle-style" />
      <Check label="Fillers" on={writing.style.fillers} onClick={flip('style', 'fillers')} />
      <Check label="Clichés" on={writing.style.cliches} onClick={flip('style', 'cliches')} />
      <Check label="Redundancies" on={writing.style.redundancies} onClick={flip('style', 'redundancies')} />
      <Check
        label={`Your words${writing.style.customWords.length > 0 ? ` (${writing.style.customWords.length})` : ''}`}
        on={writing.style.custom}
        onClick={flip('style', 'custom')}
      />

      <span className="wmenu__sep" />
      <Master icon="user-round" label="Show authors" on={writing.authors.on} onClick={toggleAuthors} command="writing:toggle-authors" />
      <Check label="Human" on={writing.authors.human} onClick={flip('authors', 'human')} />
      <Check label="AI" colour="var(--author-ai)" on={writing.authors.ai} onClick={flip('authors', 'ai')} />
      <Check label="Reference" colour="var(--author-reference)" on={writing.authors.reference} onClick={flip('authors', 'reference')} />
      <div className="wmenu__actions">
        <span>Mark selection as</span>
        <button onClick={() => void commands.run('writing:mark-human')}>Mine</button>
        <button onClick={() => void commands.run('writing:mark-ai')}>AI</button>
        <button onClick={() => void commands.run('writing:mark-reference')}>Reference</button>
      </div>

      <span className="wmenu__sep" />
      <Check
        label="Check spelling"
        on={writing.spellcheck}
        onClick={() => updateWriting((s) => ({ ...s, spellcheck: !s.spellcheck }))}
      />
      {onOpenSettings !== undefined && (
        <button className="wmenu__more" onClick={onOpenSettings}>
          More in Settings…
        </button>
      )}
    </div>,
    document.body,
  )
}
