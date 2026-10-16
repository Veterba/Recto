import { useState } from 'react'
import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import type { Board } from '../boards'
import { WIDGETS, widgetsOf, type WidgetProps } from './registry'

/** The drag type of a widget being moved, so a dragged card or file is not taken for one. */
const MIME = 'application/x-recto-widget'

/**
 * The strip above the board: each chosen widget with a ✕, then "+ Widget".
 * The menu lists every widget, ticked when shown, so it always has something
 * to offer; a widget is dragged by its header to a new place.
 */
export function WidgetStrip({ board, onEditBoard, ...props }: Omit<WidgetProps, 'board'> & { board: Board; onEditBoard: (next: Board) => void }): React.ReactElement {
  const state = widgetsOf(board)
  const menu = useContextMenu<null>()
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const shown = state.list.map((id) => WIDGETS.find((w) => w.id === id)).filter((w) => w !== undefined)
  const setList = (list: string[]): void => onEditBoard({ ...board, widgets: { ...state, list } })

  const items: MenuItem[] = [
    { kind: 'heading', label: 'Widgets' },
    ...WIDGETS.map<MenuItem>((widget) => {
      const on = state.list.includes(widget.id)
      return {
        kind: 'item',
        label: `${widget.title} — ${widget.description}`,
        icon: on ? 'check' : 'plus',
        run: () => setList(on ? state.list.filter((id) => id !== widget.id) : [...state.list, widget.id]),
      }
    }),
  ]

  /** Move the dragged widget to slot `index` of the shown list. */
  const place = (id: string, index: number): void => {
    const ids = shown.map((w) => w.id)
    const from = ids.indexOf(id)
    if (from === -1) return
    ids.splice(from, 1)
    ids.splice(from < index ? index - 1 : index, 0, id)
    // Ids the registry no longer knows stay in the file, after the rest.
    setList([...ids, ...state.list.filter((w) => !ids.includes(w))])
  }

  return (
    <div className="board-widgets" aria-label="Widgets">
      {shown.map(({ id, title, width, Component }, index) => (
        <section
          key={id}
          className={`board-widget glass-surface board-widget--${width}${dragging === id ? ' is-dragging' : ''}${over === index && dragging !== id ? ' is-drop' : ''}`}
          aria-label={title}
          data-widget={id}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(MIME)) return
            event.preventDefault()
            const box = event.currentTarget.getBoundingClientRect()
            setOver(event.clientX < box.left + box.width / 2 ? index : index + 1)
          }}
          onDrop={(event) => {
            const dropped = event.dataTransfer.getData(MIME)
            if (dropped === '' || over === null) return
            event.preventDefault()
            place(dropped, over)
            setDragging(null)
            setOver(null)
          }}
        >
          <header
            className="board-widget__head"
            draggable
            title="Drag to move"
            onDragStart={(event) => {
              event.dataTransfer.setData(MIME, id)
              event.dataTransfer.effectAllowed = 'move'
              setDragging(id)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
          >
            <h3>{title}</h3>
            <button
              className="icon-btn board-widget__x"
              aria-label={`Remove ${title}`}
              onClick={() => setList(state.list.filter((w) => w !== id))}
            >
              <Icon name="x" size={12} />
            </button>
          </header>
          <Component board={board} {...props} />
        </section>
      ))}
      <button className="board-widget board-widget--add" onClick={(event) => menu.open(event, null)}>
        <Icon name="plus" size={13} />
        Widget
      </button>
      {menu.menu !== null && <ContextMenu items={items} at={menu.menu.at} onClose={menu.close} />}
    </div>
  )
}
