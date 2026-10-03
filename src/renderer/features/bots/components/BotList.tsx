import { useEffect, useMemo, useState } from 'react'
import type { Bot, BotMessage } from '@shared/bots'
import { parseTopic } from '@shared/chat-topics'
import { IPC } from '@shared/ipc'
import type { FileNode } from '@shared/vault'
import { api } from '../../../app/api'
import { useNoteBus } from '../../../app/note-bus'
import { fuzzyMatch } from '../../../ui/fuzzy'
import { RectoBot } from '../../recto-bot'
import { topicPaths } from '../chat-topics-model'
import { useBots } from '../hooks/use-bots'
import { useUnread } from '../unread'
import { previewOf, shortTime } from '../threads'
import { MAIN_BOT } from './BotConversation'

/**
 * The AI section's sidebar: the bots, like contacts. Recto first - the keeper
 * of the vault, and the main chat - then, under a divider, the specialist bots
 * (the divider and the list only once there are some). Each shows its face,
 * name, the last thing said in its newest topic, and when.
 */

type Props = {
  tree: readonly FileNode[]
  /** The bot on screen, if any. */
  activeBot: string | null
  query: string
  onOpen: (bot: Bot) => void
}

/** A file's node in the tree, by path. */
function nodeAt(tree: readonly FileNode[], path: string): FileNode | undefined {
  for (const node of tree) {
    if (node.path === path) return node
    if (node.children !== undefined && path.startsWith(`${node.path}/`)) return nodeAt(node.children, path)
  }
  return undefined
}

function BotRow({
  bot,
  tree,
  active,
  onOpen,
}: {
  bot: Bot
  tree: readonly FileNode[]
  active: boolean
  onOpen: Props['onOpen']
}): React.ReactElement {
  const newest = useMemo(() => {
    const path = topicPaths(tree, bot.id)[0]
    return path === undefined ? null : { path, mtime: nodeAt(tree, path)?.mtime }
  }, [tree, bot.id])
  const [last, setLast] = useState<{ messages: BotMessage[]; text: string; seenAt: number }>({ messages: [], text: '', seenAt: 0 })
  // The app's own writes are not echoed back into the tree, so a chat saving a
  // turn shows up here as a bump of the note bus, not as a new mtime.
  const { revision } = useNoteBus()

  useEffect(() => {
    if (newest === null) {
      setLast({ messages: [], text: '', seenAt: 0 })
      return
    }
    let cancelled = false
    void api.invoke(IPC.fsRead, newest.path).then((result) => {
      if (cancelled) return
      const text = result.ok ? result.content : ''
      setLast((prev) =>
        prev.text === text
          ? prev
          : { messages: parseTopic(text, [bot.name, 'Claude']).messages, text, seenAt: prev.text === '' ? 0 : Date.now() },
      )
    })
    return () => {
      cancelled = true
    }
  }, [newest?.path, newest?.mtime, bot.name, revision])

  const unread = useUnread(bot.id)
  const preview = previewOf(last.messages)
  // When it was last written: the moment this row saw it change, when it did;
  // otherwise the file's own time (as on opening the app).
  const at = last.seenAt > 0 ? last.seenAt : (newest?.mtime ?? 0)
  return (
    <button className={`bot-row${active ? ' is-active' : ''}`} onClick={() => onOpen(bot)}>
      <span className="bot-face bot-face--row">
        <RectoBot id={bot.id} size={48} look={bot.look} personality={bot.personality} />
      </span>
      <span className="bot-row__text">
        <span className="bot-row__top">
          <span className="bot-row__name">{bot.name}</span>
          {at > 0 && last.messages.length > 0 && <span className="bot-row__time">{shortTime(at)}</span>}
        </span>
        <span className="bot-row__bottom">
          <span className="bot-row__preview">{preview === '' ? bot.specialty : preview}</span>
          {unread && !active && <span className="bot-row__unread" aria-label="New answer" />}
        </span>
      </span>
    </button>
  )
}

export function BotList({ tree, activeBot, query, onOpen }: Props): React.ReactElement | null {
  const bots = useBots()
  if (bots === null) return null
  const trimmed = query.trim()
  const matches = (bot: Bot): boolean => trimmed === '' || fuzzyMatch(trimmed, bot.name) !== null
  const main = bots.find((bot) => bot.id === MAIN_BOT)
  const specialists = bots.filter((bot) => bot.id !== MAIN_BOT && matches(bot))
  return (
    <section className="bot-list" aria-label="Bots">
      {main !== undefined && matches(main) && <BotRow bot={main} tree={tree} active={activeBot === main.id} onOpen={onOpen} />}
      {specialists.length > 0 && (
        <>
          <div className="bot-list__divider" role="separator" />
          {specialists.map((bot) => (
            <BotRow key={bot.id} bot={bot} tree={tree} active={bot.id === activeBot} onOpen={onOpen} />
          ))}
        </>
      )}
    </section>
  )
}
