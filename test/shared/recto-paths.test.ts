import { describe, expect, it } from 'vitest'
import { boardText } from '../../src/shared/kanban'
import { cardFolderFor, isPlacedCard, ownFolderOf, placeFor } from '../../src/shared/recto-paths'

/**
 * Where Recto's own notes live: a board in its folder, cards beside the board
 * they belong to, cards on no board in Unsorted - and a note from anywhere
 * else never moved.
 */

const A = 'Recto/Boards/A/A.md'
const B = 'Recto/Boards/B/B.md'
const OUTSIDE = 'Projects/Plan board.md'

describe('a board’s own folder', () => {
  it('is Recto/Boards/<Board>/ when the board note is named after it', () => {
    expect(ownFolderOf(A)).toBe('Recto/Boards/A')
    expect(ownFolderOf('Recto/Boards/A/Other.md')).toBeNull()
    expect(ownFolderOf(OUTSIDE)).toBeNull()
    expect(ownFolderOf('Recto/Boards/A/deeper/A.md')).toBeNull()
  })
})

describe('which cards Recto places', () => {
  it('those in a board’s folder or in Unsorted, nothing else', () => {
    expect(isPlacedCard('Recto/Boards/A/Card.md')).toBe(true)
    expect(isPlacedCard('Recto/Unsorted/Card.md')).toBe(true)
    expect(isPlacedCard('Recto/Unsorted/sub/Card.md')).toBe(true)
    expect(isPlacedCard('Garden/Basil.md')).toBe(false)
    expect(isPlacedCard('Recto/Chats/recto/t.md')).toBe(false)
    expect(isPlacedCard('Recto/Boards/Stray.md')).toBe(false)
  })
})

describe('placeFor', () => {
  it('a card on no board goes to Unsorted', () => {
    expect(placeFor('Recto/Boards/A/Card.md', [])).toBe('Recto/Unsorted')
    expect(placeFor('Recto/Unsorted/Card.md', [])).toBeNull()
  })

  it('a card left on exactly one other board goes to that board’s folder', () => {
    expect(placeFor('Recto/Boards/A/Card.md', [B])).toBe('Recto/Boards/B')
    expect(placeFor('Recto/Unsorted/Card.md', [A])).toBe('Recto/Boards/A')
    expect(placeFor('Recto/Boards/A/Card.md', [A])).toBeNull()
  })

  it('a card on several boards stays where it is', () => {
    expect(placeFor('Recto/Boards/A/Card.md', [A, B])).toBeNull()
    expect(placeFor('Recto/Unsorted/Card.md', [A, B])).toBeNull()
  })

  it('a card on several boards, none of them the one whose folder it is in, goes to the first by name', () => {
    expect(placeFor('Recto/Boards/Gone/Card.md', [B, A])).toBe('Recto/Boards/A')
  })

  it('a card whose only board lives outside Recto stays, unless its folder’s board let it go', () => {
    expect(placeFor('Recto/Unsorted/Card.md', [OUTSIDE])).toBeNull()
    expect(placeFor('Recto/Boards/Gone/Card.md', [OUTSIDE])).toBe('Recto/Unsorted')
  })

  it('never moves a note from outside Recto’s folders', () => {
    expect(placeFor('Garden/Basil.md', [])).toBeNull()
    expect(placeFor('Garden/Basil.md', [A])).toBeNull()
  })
})

describe('where a new card goes', () => {
  it('the board’s new-note-folder, else its own folder, else Unsorted', () => {
    const plain = boardText([{ title: 'To do', items: [] }])
    expect(cardFolderFor(A, plain)).toBe('Recto/Boards/A')
    expect(cardFolderFor(OUTSIDE, plain)).toBe('Recto/Unsorted')
    expect(cardFolderFor(OUTSIDE, boardText([{ title: 'To do', items: [] }], { 'new-note-folder': 'Projects/Cards' }))).toBe('Projects/Cards')
    expect(cardFolderFor(A, null)).toBe('Recto/Boards/A')
  })
})
