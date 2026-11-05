import { boardOfCard } from '../../boards'
import { CardPanel } from '../../boards/components/CardPanel'
import { useBoardCards } from '../../boards/hooks/use-board-cards'

/**
 * A task opened from a canvas: its card, on the right of the canvas, as the
 * board shows it beside its lanes - the same panel, the same writes. The
 * canvas stays where it was.
 */
export function CanvasCardPanel({
  path,
  onChoose,
  onOpenNote,
  onClose,
}: {
  path: string
  /** The card is renamed or made a note: it is that file now. */
  onChoose: (path: string) => void
  onOpenNote: (path: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const { board, cards, editCard, move, makeNote, renameCard } = useBoardCards(boardOfCard(path) ?? '')
  const card = cards?.find((c) => c.path === path) ?? null
  if (board === null || card === null) return null
  return (
    <div className="canvas-card-panel nodrag nopan nowheel">
      <CardPanel
        key={card.key}
        board={board}
        card={card}
        editCard={editCard}
        move={move}
        onRename={async (name) => {
          const next = await renameCard(card.path, name)
          if (next !== null) onChoose(next)
        }}
        onMakeNote={async () => {
          const made = await makeNote(card.key)
          if (made !== null) onChoose(made)
        }}
        onOpenNote={onOpenNote}
        onClose={onClose}
      />
    </div>
  )
}
