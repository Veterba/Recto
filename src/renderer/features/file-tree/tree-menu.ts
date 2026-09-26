import type { FileNode } from '@shared/vault'
import { IPC } from '@shared/ipc'
import { api } from '../../app/api'
import type { MenuItem } from '../../ui/ContextMenu'

function copy(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => {
    // Clipboard permission can be refused; a failed copy is not worth a
    // dialog, and the path is visible on the row anyway.
  })
}

/**
 * The right-click menu for one node.
 *
 * Only actions that actually work appear here. A menu is a promise about
 * what the app can do, and an entry that opens nothing is worse than no
 * entry at all.
 */
export function treeMenu(
  node: FileNode,
  {
    vaultPath,
    onCreateIn,
    rename,
    archive,
  }: {
    vaultPath: string
    onCreateIn: (parent: string, kind: 'file' | 'folder') => void
    rename: (path: string) => void
    archive: (node: FileNode) => void
  },
): MenuItem[] {
  const isFolder = node.kind === 'folder'
  const parent = isFolder ? node.path : node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')))
  const full = vaultPath === '' ? node.path : `${vaultPath}/${node.path}`

  return [
    { kind: 'heading', label: isFolder ? 'Inside this folder' : 'Alongside this note' },
    {
      kind: 'item',
      label: 'New note',
      icon: 'file-plus',
      run: () => onCreateIn(parent, 'file'),
    },
    {
      kind: 'item',
      label: 'New folder',
      icon: 'folder-plus',
      run: () => onCreateIn(parent, 'folder'),
    },
    { kind: 'separator' },
    { kind: 'heading', label: isFolder ? 'This folder' : 'This note' },
    { kind: 'item', label: 'Rename', icon: 'pencil', shortcut: 'F2', run: () => rename(node.path) },
    {
      kind: 'item',
      label: 'Copy relative path',
      icon: 'copy',
      run: () => copy(node.path),
    },
    {
      kind: 'item',
      label: 'Copy full path',
      icon: 'clipboard-copy',
      run: () => copy(full),
    },
    {
      kind: 'item',
      label: 'Reveal in Finder',
      icon: 'external-link',
      run: () => void api.invoke(IPC.fsReveal, node.path),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Move to archive',
      icon: 'trash',
      danger: true,
      run: () => archive(node),
    },
  ]
}
