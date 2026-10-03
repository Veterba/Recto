import { useState } from 'react'
import type { Bot, BotSource, BotStep } from '@shared/bots'
import type { TopicMessage } from '@shared/chat-topics'
import { Tip } from '../../../ui/Tip'
import { RectoBot, type BotState } from '../../recto-bot'
import type { LoadedTopic } from '../chat-topics-model'
import { groupMessages } from '../grouping'
import { Markdown } from './Markdown'
import { modelLabel } from './ModelMenu'
import { StepsCard } from './StepsCard'

/**
 * A topic's messages, the way a messenger shows them: mine on the right, the
 * bot's on the left, consecutive ones from one side grouped tightly, the
 * bot's face only beside its latest message. Hovering a message shows when it
 * was sent.
 */

export type Pending = {
  /** The answer so far: '' before its first token. */
  text: string
  steps: BotStep[]
  sources: BotSource[]
  face: BotState
  at: string
}

export type MessageActions = {
  onOpen: (path: string, heading?: string | null) => void
  /** A note named in an answer or a [[link]]: open it by title. */
  onOpenNote: (title: string, sources: readonly BotSource[]) => void
}

const noteTitle = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** "14:02" for a message's time; '' when it has none. */
export function clock(at: string | undefined): string {
  if (at === undefined) return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** The notes an answer was read from: small chips under it, four at most and "+N" for the rest. */
function Sources({ sources, onOpen }: { sources: readonly BotSource[]; onOpen: MessageActions['onOpen'] }): React.ReactElement | null {
  const [all, setAll] = useState(false)
  const notes = sources.filter((s, i) => sources.findIndex((o) => o.path === s.path) === i)
  if (notes.length === 0) return null
  const shown = all ? notes : notes.slice(0, 4)
  return (
    <div className="msg-sources" aria-label="Sources">
      {shown.map((source) => {
        const folder = source.path.includes('/') ? source.path.slice(0, source.path.lastIndexOf('/')) : ''
        return (
          <Tip key={source.path} label={folder === '' ? 'Vault root' : folder} hint={source.heading ?? undefined} placement="bottom">
            <button className="msg-sources__note" onClick={() => onOpen(source.path, source.heading)}>
              {noteTitle(source.path)}
            </button>
          </Tip>
        )
      })}
      {notes.length > shown.length && (
        <button className="msg-sources__note msg-sources__more" onClick={() => setAll(true)}>
          +{notes.length - shown.length}
        </button>
      )}
    </div>
  )
}

/** My message: plain text, with [[links]] as note chips. */
function MyText({ text, onOpenNote }: { text: string; onOpenNote: (title: string) => void }): React.ReactElement {
  const parts = text.split(/(\[\[[^\]\n]+\]\])/)
  return (
    <p className="msg-mine__text">
      {parts.map((part, i) => {
        const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(part)
        if (link === null) return <span key={i}>{part}</span>
        return (
          <button key={i} className="note-chip" onClick={() => onOpenNote(link[1]!.trim())}>
            {(link[2] ?? link[1]!).trim()}
          </button>
        )
      })}
    </p>
  )
}

function Bubble({ message, actions }: { message: TopicMessage; actions: MessageActions }): React.ReactElement {
  const mine = message.role === 'user'
  const sources = message.sources ?? []
  const titles = sources.map((s) => noteTitle(s.path))
  const openNote = (title: string): void => actions.onOpenNote(title, sources)
  return (
    <div className={`msg${mine ? ' msg--mine' : ' msg--bot'}`}>
      <div className="msg__bubble">
        {mine ? (
          <MyText text={message.content} onOpenNote={openNote} />
        ) : (
          <Markdown text={message.content} titles={titles} onOpenNote={openNote} />
        )}
      </div>
      <span className="msg__when">{clock(message.at)}</span>
    </div>
  )
}

/** The bot's face beside its latest message - the only one in the conversation: live, and the one that riffles while it looks. */
function GroupFace({ bot, state }: { bot: Bot; state: BotState }): React.ReactElement {
  return (
    <span className="bot-face bot-face--group" aria-hidden="true">
      <RectoBot size={36} look={bot.look} personality={bot.personality} state={state} />
    </span>
  )
}

export function TopicBlock({
  topic,
  past,
  bot,
  pending,
  error,
  onDismissError,
  actions,
  face,
}: {
  topic: LoadedTopic
  past: boolean
  bot: Bot
  pending: Pending | null
  error: string | null
  onDismissError: () => void
  actions: MessageActions
  /** The face's state, for the topic that has the latest answer; null elsewhere. */
  face: BotState | null
}): React.ReactElement {
  const groups = groupMessages(topic.messages)
  // The face goes beside the latest answer: the one coming, or else the last one written.
  const lastBot = pending !== null ? -1 : groups.findLastIndex((g) => g.role === 'assistant')
  return (
    <section className={`chat-topic${past ? ' is-past' : ''}`} data-topic={topic.path}>
      <TopicDivider title={topic.meta.title} at={topic.meta.created} />
      {groups.map((group, g) => (
        <div key={group.indexes[0]} className="msg-group-wrap">
          {group.switchedTo !== null && (
            <div className="chat-divider" role="separator">
              Switched to <b>{modelLabel(group.switchedTo)}</b>
            </div>
          )}
          <div className={`msg-group msg-group--${group.role === 'user' ? 'mine' : 'bot'}`}>
            {group.indexes.map((index) => {
              const message = topic.messages[index]!
              return (
                <div key={index} className="msg-row">
                  {message.steps !== undefined && <StepsCard steps={message.steps} running={false} />}
                  <Bubble message={message} actions={actions} />
                  {message.sources !== undefined && <Sources sources={message.sources} onOpen={actions.onOpen} />}
                </div>
              )
            })}
            {face !== null && g === lastBot && <GroupFace bot={bot} state={face} />}
          </div>
        </div>
      ))}
      {pending !== null && (
        <div className="msg-group msg-group--bot is-pending">
          <div className="msg-row">
            <StepsCard steps={pending.steps} running={pending.text === ''} />
            {pending.text !== '' && (
              <Bubble message={{ role: 'assistant', content: pending.text, sources: pending.sources }} actions={actions} />
            )}
          </div>
          {face !== null && <GroupFace bot={bot} state={face} />}
        </div>
      )}
      {error !== null && (
        <p className="chat__error" role="alert" onClick={onDismissError}>
          {error}
        </p>
      )}
    </section>
  )
}

/** "New topic · <title> · 14:02", centred and muted. */
export function TopicDivider({ title, at }: { title: string | null; at?: string }): React.ReactElement {
  const time = clock(at)
  return (
    <div className="chat-divider chat-topic__divider" role="separator">
      New topic
      {title !== null && (
        <>
          {' · '}
          <b>{title}</b>
        </>
      )}
      {time !== '' && <> · {time}</>}
    </div>
  )
}
