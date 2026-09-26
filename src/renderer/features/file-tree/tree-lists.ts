import type { FileNode } from '@shared/vault'

/** Flat lists out of the vault tree, depth first in tree order. */

/** Every file in the tree, notes or not. */
export function allFilePaths(roots: readonly FileNode[], out: string[] = []): string[] {
  for (const node of roots) {
    if (node.kind === 'folder') allFilePaths(node.children ?? [], out)
    else out.push(node.path)
  }
  return out
}

/** Every note (`.md`) path. */
export function notePaths(roots: readonly FileNode[], out: string[] = []): string[] {
  for (const node of roots) {
    if (node.kind === 'folder') notePaths(node.children ?? [], out)
    else if (node.name.toLowerCase().endsWith('.md')) out.push(node.path)
  }
  return out
}

/** A note as pickers list it: its path, its name without `.md`, and its folder. */
type NoteEntry = { path: string; name: string; folder: string }

/** Every note, as pickers and `[[` autocomplete list it. */
export function noteEntries(roots: readonly FileNode[], out: NoteEntry[] = []): NoteEntry[] {
  for (const node of roots) {
    if (node.kind === 'folder') noteEntries(node.children ?? [], out)
    else if (node.name.toLowerCase().endsWith('.md')) {
      const at = node.path.lastIndexOf('/')
      out.push({ path: node.path, name: node.name.replace(/\.md$/i, ''), folder: at === -1 ? '' : node.path.slice(0, at) })
    }
  }
  return out
}
