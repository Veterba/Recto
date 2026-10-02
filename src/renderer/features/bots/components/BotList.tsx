import { useEffect, useMemo, useState } from 'react'
import type { Bot, BotMessage } from '@shared/bots'
import { IPC } from '@shared/ipc'
import type { FileNode } from '@shared/vault'
import { api } from '../../../app/api'
import { useNoteBus } from '../../../app/note-bus'
import { fuzzyMatch } from '../../../ui/fuzzy'
import { RectoBot } from '../../recto-bot'
import { useBots } from '../hooks/use-bots'
import { parseThread, previewOf, shortTime, threadsOf } from '../threads'

/**
 * The bots, under the main chat, like a list of contacts: each one's face,
 * name, the last thing said and when. A bot's newest thread is what opens.
 */

type Props = {
  tree: readonly FileNode[]
  /** The bot whose thread is on screen, if any. */
  activeBot: string | null
  query: string
  onOpen: (bot: Bot, threadPath: string | null) => void
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
  const newest = useMemo(() => threadsOf(tree, bot.id)[0] ?? null, [tree, bot.id])
  const [last, setLast] = useState<{ messages: BotMessage[]; text: string; seenAt: number }>({ messages: [], text: '', seenAt: 0 })
  // The app's own writes are not echoed back into the tree, so a bot's chat
  // saving a turn shows up here as a bump of the note bus, not as a new mtime.
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
        prev.text === text ? prev : { messages: parseThread(text, bot.name).messages, text, seenAt: prev.text === '' ? 0 : Date.now() },
      )
    })
    return () => {
      cancelled = true
    }
  }, [newest?.path, newest?.mtime, bot.name, revision])

  const preview = previewOf(last.messages)
  // When the thread last changed: the tree's mtime, or later if this row saw it change since.
  const at = Math.max(newest?.mtime ?? 0, last.seenAt)
  return (
    <button className={`bot-row${active ? ' is-active' : ''}`} onClick={() => onOpen(bot, newest?.path ?? null)}>
      <span className="bot-face bot-face--row">
        <RectoBot size={48} look={bot.look} personality={bot.personality} />
      </span>
      <span className="bot-row__text">
        <span className="bot-row__top">
          <span className="bot-row__name">{bot.name}</span>
          {at > 0 && last.messages.length > 0 && <span className="bot-row__time">{shortTime(at)}</span>}
        </span>
        <span className="bot-row__preview">{preview === '' ? bot.specialty : preview}</span>
      </span>
    </button>
  )
}

export function BotList({ tree, activeBot, query, onOpen }: Props): React.ReactElement | null {
  const bots = useBots()
  if (bots === null || bots.length === 0) return null
  const trimmed = query.trim()
  const shown = trimmed === '' ? bots : bots.filter((bot) => fuzzyMatch(trimmed, bot.name) !== null)
  if (shown.length === 0) return null
  return (
    <section className="bot-list" aria-label="Bots">
      <h3 className="bot-list__head">Bots</h3>
      {shown.map((bot) => (
        <BotRow key={bot.id} bot={bot} tree={tree} active={bot.id === activeBot} onOpen={onOpen} />
      ))}
    </section>
  )
}
