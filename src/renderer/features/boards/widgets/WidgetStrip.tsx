import { ContextMenu, useContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import type { Board } from '../boards'
import { WIDGETS, widgetsOf, type WidgetProps } from './registry'

/** The strip above the board: each chosen widget with a ✕, then "+ Widget". */
export function WidgetStrip({ board, onEditBoard, ...props }: WidgetProps & { onEditBoard: (next: Board) => void }): React.ReactElement {
  const state = widgetsOf(board)
  const menu = useContextMenu<null>()
  const shown = state.list.map((id) => WIDGETS.find((w) => w.id === id)).filter((w) => w !== undefined)
  const setList = (list: string[]): void => onEditBoard({ ...board, widgets: { ...state, list } })

  const items: MenuItem[] = WIDGETS.map((widget) => ({
    kind: 'item',
    label: `${widget.title} — ${widget.description}`,
    disabled: state.list.includes(widget.id),
    run: () => setList([...state.list, widget.id]),
  }))

  return (
    <div className="board-widgets" aria-label="Widgets">
      {shown.map(({ id, title, width, Component }) => (
        <section key={id} className={`board-widget glass-surface board-widget--${width}`} aria-label={title} data-widget={id}>
          <header className="board-widget__head">
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
      <button
        className="board-widget board-widget--add"
        onClick={(event) => menu.open(event, null)}
        disabled={shown.length === WIDGETS.length}
      >
        <Icon name="plus" size={13} />
        Widget
      </button>
      {menu.menu !== null && <ContextMenu items={items} at={menu.menu.at} onClose={menu.close} />}
    </div>
  )
}
