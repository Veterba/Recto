import { useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { addDays, isoDay, setCardField } from '@shared/card-fields'
import { Icon } from '../../../ui/Icon'
import type { MenuItem } from '../../../ui/ContextMenu'
import { boardOfCard } from '../../boards'
import { PriorityLabel } from '../../boards/components/BoardCard'
import { useBoardCards } from '../../boards/hooks/use-board-cards'
import { doneColumn } from '../../boards/boards'
import { dueState, spanLabel } from '../../boards/board-view'
import type { FlowNode } from '../canvas-flow'
import { useCanvasActions } from '../canvas-actions'
import { Frame } from './CanvasNodes'

/**
 * A board's card on a canvas, as a node of its own.
 *
 * Drawn the way its board draws it - status, priority, dates - and changed
 * the way its board changes it: the same hook, so marking it done or moving
 * it to a lane writes the board note (and the card's note) exactly as
 * dragging it on the board would. A whole board is CanvasBoardPreview.tsx.
 */

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function CardNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  const board = boardOfCard(path) ?? ''
  const { board: shown, cards, move, editCard } = useBoardCards(board)
  const card = cards?.find((c) => c.path === path) ?? null
  const column = shown?.columns.find((c) => c.id === card?.column) ?? null
  const done = shown === null ? null : doneColumn(shown.columns)
  const today = isoDay(new Date())

  // What its board's menu has for it: where it can go, its priority, its due date.
  useEffect(() => {
    if (card === null || shown === null) return actions.registerMenu(node.id, null)
    const items: MenuItem[] = [
      { kind: 'heading', label: `On “${nameOf(board)}”` },
      ...(done !== null && card.column !== done
        ? [
            {
              kind: 'item',
              label: 'Mark done',
              icon: 'check',
              run: () => void move(card.key, { column: done, index: Number.MAX_SAFE_INTEGER }),
            } as MenuItem,
          ]
        : []),
      ...shown.columns
        .filter((c) => c.id !== card.column)
        .map<MenuItem>((c) => ({
          kind: 'item',
          label: `Move to ${c.name}`,
          icon: 'arrow-right',
          run: () => void move(card.key, { column: c.id, index: Number.MAX_SAFE_INTEGER }),
        })),
      { kind: 'separator' },
      ...(['high', 'medium', 'low'] as const).map<MenuItem>((level) => ({
        kind: 'item',
        label: `Priority ${level}`,
        icon: card.level === level ? 'check' : 'minus',
        run: () => void editCard(card.path, (t) => setCardField(t, 'priority', level)),
      })),
      { kind: 'item', label: 'Due today', icon: 'calendar', run: () => void editCard(card.path, (t) => setCardField(t, 'due', today)) },
      {
        kind: 'item',
        label: 'Due tomorrow',
        icon: 'calendar',
        run: () => void editCard(card.path, (t) => setCardField(t, 'due', addDays(today, 1))),
      },
      ...(card.due !== null
        ? [
            {
              kind: 'item',
              label: 'No due date',
              icon: 'x',
              run: () => void editCard(card.path, (t) => setCardField(t, 'due', null)),
            } as MenuItem,
          ]
        : []),
      { kind: 'separator' },
    ]
    actions.registerMenu(node.id, items)
    return () => actions.registerMenu(node.id, null)
  }, [actions, node.id, card, shown, done, board, move, editCard, today])

  const state = card === null ? null : dueState(card.span, today)
  return (
    <Frame props={props} className={`canvas-node--card${card !== null && card.column === done ? ' is-done' : ''}`}>
      {/* Double-clicked anywhere, the card opens beside the canvas, as on its board. */}
      <div className="canvas-card" onDoubleClick={() => actions.openFile(path)}>
        <header className="canvas-note__title">
          <Icon name={card !== null && card.column === done ? 'check' : 'square-kanban'} size={13} />
          <span>{column?.name ?? 'Card'}</span>
        </header>
        <div className="canvas-node__body canvas-card">
          {card !== null && (
            <div className="canvas-card__top">
              <PriorityLabel card={card} />
              {card.span !== null && (
                <span className={`board-card__when${state === null ? '' : ` is-${state}`}`}>
                  <Icon name="calendar" size={11} />
                  {spanLabel(card.span, today)}
                </span>
              )}
            </div>
          )}
          <p className="canvas-card__title">{card?.title ?? nameOf(path)}</p>
          {card !== null && card.description !== '' && <p className="canvas-card__text">{card.description}</p>}
        </div>
      </div>
    </Frame>
  )
}
