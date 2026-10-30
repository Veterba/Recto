import { useRef, useState } from 'react'
import { viewTitle } from '../view-registry'
import type { HistoryEntry } from '../workspace'
import { historyOf, travel, useHistoryVersion } from '../tab-history'
import { commands } from '../commands'
import { ContextMenu, type MenuItem } from '../../ui/ContextMenu'
import { Icon } from '../../ui/Icon'
import { Tip } from '../../ui/Tip'
import { metaHeld } from '../../ui/meta-key'

/**
 * A tab's ← and →, at the top left of what it shows.
 *
 * Each says how many steps it holds; ⌘ over it names where it goes. A
 * right-click - or a long press - lists the steps, nearest first, and picking
 * one jumps there, several steps at once. ⌘ on a click, here or in the list,
 * opens that step in a new tab and leaves this one where it is.
 */

type Direction = 'back' | 'forward'

/** How long a press is held before it counts as asking for the list. */
const LONG_PRESS_MS = 450

/** A step as the list and the tooltip name it: a card on a board reads "Board › Card". */
export function entryTitle(entry: HistoryEntry): string {
  const title = viewTitle(entry.type, entry.state)
  const card = entry.state['card']
  if (entry.type !== 'board' || typeof card !== 'string') return title
  return `${title} › ${card.slice(card.lastIndexOf('/') + 1).replace(/\.md$/i, '')}`
}

const ICON: Record<string, string> = { board: 'square-kanban', overview: 'house' }

export function NavArrows({ leafId }: { leafId: string }): React.ReactElement {
  useHistoryVersion()
  const history = historyOf(leafId)
  const [list, setList] = useState<{ direction: Direction; at: { x: number; y: number } } | null>(null)

  const items = (direction: Direction): MenuItem[] =>
    (direction === 'back' ? history.back : history.forward).map((entry, i) => ({
      kind: 'item',
      label: entryTitle(entry),
      icon: ICON[entry.type] ?? 'file-text',
      run: () => travel(leafId, direction === 'back' ? -(i + 1) : i + 1, metaHeld()),
    }))

  return (
    <div className="nav-arrows">
      <Arrow
        direction="back"
        entries={history.back}
        shortcut={commands.label('nav:back')}
        onGo={(newTab) => travel(leafId, -1, newTab)}
        onList={(at) => setList({ direction: 'back', at })}
      />
      <Arrow
        direction="forward"
        entries={history.forward}
        shortcut={commands.label('nav:forward')}
        onGo={(newTab) => travel(leafId, 1, newTab)}
        onList={(at) => setList({ direction: 'forward', at })}
      />
      {list !== null && <ContextMenu items={items(list.direction)} at={list.at} onClose={() => setList(null)} />}
    </div>
  )
}

function Arrow({
  direction,
  entries,
  shortcut,
  onGo,
  onList,
}: {
  direction: Direction
  entries: readonly HistoryEntry[]
  shortcut: string | null
  onGo: (newTab: boolean) => void
  onList: (at: { x: number; y: number }) => void
}): React.ReactElement {
  const timer = useRef(0)
  /** A long press opened the list: the click that ends it does not also go. */
  const listed = useRef(false)
  const next = entries[0]
  const empty = next === undefined

  const button = (
    <button
      className="nav-arrows__btn"
      disabled={empty}
      aria-label={`${direction === 'back' ? 'Back' : 'Forward'}${next === undefined ? '' : ` to ${entryTitle(next)}`}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        listed.current = false
        const at = { x: event.clientX, y: event.clientY }
        timer.current = window.setTimeout(() => {
          listed.current = true
          onList(at)
        }, LONG_PRESS_MS)
      }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerLeave={() => window.clearTimeout(timer.current)}
      onClick={(event) => {
        if (listed.current) return
        onGo(event.metaKey)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!empty) onList({ x: event.clientX, y: event.clientY })
      }}
    >
      <Icon name={direction === 'back' ? 'arrow-left' : 'arrow-right'} size={14} />
      {!empty && <span className="nav-arrows__count">{entries.length}</span>}
    </button>
  )

  if (next === undefined) return button
  return (
    <Tip label={entryTitle(next)} hint={shortcut ?? undefined} placement="bottom">
      {button}
    </Tip>
  )
}
