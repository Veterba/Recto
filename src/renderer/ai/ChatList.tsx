import { useEffect, useMemo, useState } from 'react'
import type { FileNode } from '@shared/ipc-contract'
import { api } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContextMenu, useContextMenu, type MenuItem } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { fuzzyMatch } from '../core/fuzzy'
import { CHAT_FOLDER, parseConversation } from './conversation'

/**
 * The AI sidebar: which conversations exist.
 *
 * The same shape as the file tree and the board list next door, because a
 * conversation is the same kind of thing as a note and a card - it is one.
 *
 * Titles come from reading each note's heading rather than from its filename,
 * which is a timestamp. That costs one small read per conversation, which is
 * the right trade: the alternative is renaming files as titles change, and a
 * rename rewrites links across the vault.
 */

type Props = {
  tree: readonly FileNode[]
  activePath: string | null
  query: string
  onOpen: (path: string) => void
  onChanged: () => void
}

type Entry = { path: string; title: string }

export function ChatList({ tree, activePath, query, onOpen, onChanged }: Props): React.ReactElement {
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<Entry | null>(null)
  const contextMenu = useContextMenu<Entry>()

  /** Newest first: the filename is a timestamp, so this is a string sort. */
  const paths = useMemo(() => {
    const folder = tree.find((node) => node.kind === 'folder' && node.path === CHAT_FOLDER)
    return (folder?.children ?? [])
      .filter((node) => node.kind === 'file' && node.name.toLowerCase().endsWith('.md'))
      .map((node) => node.path)
      .sort((a, b) => b.localeCompare(a))
  }, [tree])

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      paths.map(async (path) => {
        const result = await api.invoke('fs:read', path)
        return [path, result.ok ? parseConversation(result.content).title : ''] as const
      }),
    ).then((pairs) => {
      if (!cancelled) setTitles(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [paths])

  const entries: Entry[] = paths.map((path) => ({
    path,
    // Until the note has a heading - which is until the first question - the
    // timestamp in the filename is the honest label.
    title: titles[path] !== undefined && titles[path] !== '' ? titles[path]! : path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
  }))

  const trimmed = query.trim()
  const shown = trimmed === '' ? entries : entries.filter((entry) => fuzzyMatch(trimmed, entry.title) !== null)

  const menuFor = (entry: Entry): MenuItem[] => [
    { kind: 'heading', label: 'This conversation' },
    { kind: 'item', label: 'Open', icon: 'sparkles', run: () => onOpen(entry.path) },
    {
      kind: 'item',
      label: 'Reveal in Finder',
      icon: 'external-link',
      run: () => void api.invoke('fs:reveal', entry.path),
    },
    { kind: 'separator' },
    { kind: 'item', label: 'Move to archive', icon: 'trash', danger: true, run: () => setConfirming(entry) },
  ]

  if (entries.length === 0) {
    return (
      <p className="sidebar__empty">
        No conversations yet. Press <kbd>New chat</kbd> — each one is saved as a markdown note in{' '}
        <code>{CHAT_FOLDER}/</code>.
      </p>
    )
  }

  return (
    <div className="boards">
      {shown.map((entry) => (
        <div
          className={`boards__row${entry.path === activePath ? ' is-active' : ''}`}
          key={entry.path}
          onContextMenu={(event) => contextMenu.open(event, entry)}
        >
          <button className="boards__name" onClick={() => onOpen(entry.path)}>
            <Icon name="message-square" size={14} />
            {entry.title}
          </button>
        </div>
      ))}

      {shown.length === 0 && <p className="sidebar__empty">No conversation matches “{trimmed}”.</p>}

      {confirming !== null && (
        <ConfirmDialog
          title="Delete conversation"
          body={
            <>
              <strong>{confirming.title}</strong> goes to the archive. Recoverable there, then it goes
              to the system trash.
            </>
          }
          confirmLabel="Move to archive"
          onConfirm={() => {
            const target = confirming.path
            setConfirming(null)
            void api.invoke('archive:add', target).then(() => onChanged())
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {contextMenu.menu !== null && (
        <ContextMenu items={menuFor(contextMenu.menu.subject)} at={contextMenu.menu.at} onClose={contextMenu.close} />
      )}
    </div>
  )
}
