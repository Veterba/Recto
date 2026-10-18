/**
 * What a `[[link]]` points at, when it is more than a note: a board, or a
 * card and where it stands. The editor draws an icon in the link for it, and
 * the `[[` list beside the name.
 *
 * Set by the boards feature from the index (features/boards/boards-store.ts),
 * read by the editor: app-level so the editor does not reach into boards.
 * Keys are a link's target as the editor sees it, lowercased: a note's name,
 * or its path without `.md`.
 */

export type LinkKind = 'board' | 'open' | 'doing' | 'done' | 'mixed'

let kinds: ReadonlyMap<string, LinkKind> = new Map()
const listeners = new Set<() => void>()

export function setLinkKinds(next: ReadonlyMap<string, LinkKind>): void {
  // Same map, same icons: no editor needs to redraw.
  if (next.size === kinds.size && [...next].every(([key, kind]) => kinds.get(key) === kind)) return
  kinds = next
  for (const listener of listeners) listener()
}

export const linkKinds = (): ReadonlyMap<string, LinkKind> => kinds

/** The kind of a link's target (`Note`, `folder/Note`, `Note.md`), or undefined for a plain note. */
export function linkKindOf(target: string): LinkKind | undefined {
  const key = target
    .replace(/\.md$/i, '')
    .normalize('NFC')
    .toLowerCase()
    .trim()
  return kinds.get(key)
}

export function onLinkKinds(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
