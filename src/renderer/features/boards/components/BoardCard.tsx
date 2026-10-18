import { Icon } from '../../../ui/Icon'
import { dueState, spanLabel, type CardView } from '../board-view'

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

/** The priority as a tinted word. A value Recto does not know is shown as written, untinted. */
export function PriorityLabel({ card }: { card: Pick<CardView, 'level' | 'priority'> }): React.ReactElement {
  if (card.level !== null) return <span className={`board-pri board-pri--${card.level}`}>{LEVEL_LABEL[card.level]}</span>
  const raw = card.priority?.trim() ?? ''
  return <span className="board-pri board-pri--none">{raw === '' ? 'No priority' : raw}</span>
}

type Props = {
  card: CardView
  today: string
  selected: boolean
  dragging: boolean
  /** The drop would land just above this card. */
  dropBefore: boolean
  onOpen: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}

/**
 * One card: priority and dates on top, the title, two lines of description,
 * and a footer with the checklist's progress, the link count and the tag.
 */
export function BoardCard({ card, today, selected, dragging, dropBefore, ...on }: Props): React.ReactElement {
  const state = dueState(card.span, today)
  const { done, total } = card.checklist
  return (
    <article
      className={`board-card${card.light ? ' board-card--light' : ''}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${dropBefore ? ' is-before' : ''}`}
      draggable
      data-path={card.path === '' ? undefined : card.path}
      aria-label={card.title}
      tabIndex={0}
      onClick={on.onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') on.onOpen()
      }}
      onDragStart={on.onDragStart}
      onDragEnd={on.onDragEnd}
      onDragOver={on.onDragOver}
      onDrop={on.onDrop}
      onContextMenu={on.onContextMenu}
    >
      {!card.light && (
        <div className="board-card__top">
          <PriorityLabel card={card} />
          {card.span !== null && (
            <span className={`board-card__when${state === null ? '' : ` is-${state}`}`}>
              <Icon name="calendar" size={11} />
              {spanLabel(card.span, today)}
            </span>
          )}
        </div>
      )}
      <h3 className="board-card__title">{card.title}</h3>
      {card.description !== '' && <p className="board-card__desc">{card.description}</p>}
      {(total > 0 || card.links > 0 || card.tagList.length > 0) && (
        <div className="board-card__foot">
          {total > 0 && (
            <span className="board-card__progress" title={`${done} of ${total} checked`}>
              <span className="board-card__bar">
                <i style={{ width: `${(done / total) * 100}%` }} />
              </span>
              {done}/{total}
            </span>
          )}
          {card.links > 0 && (
            <span className="board-card__links" title={`${card.links} ${card.links === 1 ? 'link' : 'links'}`}>
              <Icon name="link" size={11} />
              {card.links}
            </span>
          )}
          {card.tagList[0] !== undefined && <span className="board-card__tag">#{card.tagList[0]}</span>}
        </div>
      )}
    </article>
  )
}
