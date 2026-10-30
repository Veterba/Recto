/**
 * Show a file in the Data tree, from anywhere - a tab's menu, the palette.
 * The shell, which owns the sidebar and the tree's folders, sets what it does.
 */

let handler: ((path: string) => void) | null = null

export function setRevealInTreeHandler(next: typeof handler): void {
  handler = next
}

export function revealInTree(path: string): void {
  handler?.(path)
}
