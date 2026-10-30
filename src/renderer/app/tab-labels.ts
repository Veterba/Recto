/**
 * What a tab shows beside its title. Pure, so it is tested without a DOM.
 */

export type TabLabel = { id: string; title: string; path: string | null }

/**
 * The parent folder of each tab whose title another open tab shares, by leaf
 * id - "Ideas" in Garden/ and "Ideas" in Kitchen/ read "Garden" and "Kitchen".
 * A note at the vault root reads "/". Tabs with a title of their own get none.
 */
export function folderHints(tabs: readonly TabLabel[]): Map<string, string> {
  const count = new Map<string, number>()
  for (const tab of tabs) count.set(tab.title, (count.get(tab.title) ?? 0) + 1)
  const hints = new Map<string, string>()
  for (const tab of tabs) {
    if ((count.get(tab.title) ?? 0) < 2 || tab.path === null) continue
    const parent = tab.path.includes('/') ? tab.path.slice(0, tab.path.lastIndexOf('/')) : ''
    hints.set(tab.id, parent === '' ? '/' : parent.slice(parent.lastIndexOf('/') + 1))
  }
  return hints
}

/** A link to a file, the way Recto writes one: `[[Note name]]`, a non-note keeps its extension. */
export function linkTo(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return `[[${name.replace(/\.md$/i, '')}]]`
}
