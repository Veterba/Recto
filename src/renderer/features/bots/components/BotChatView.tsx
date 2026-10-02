import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Bot, BotMessage, BotSource } from '@shared/bots'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { noteIndexChanged } from '../../../app/note-bus'
import { registerView } from '../../../app/view-registry'
import { ChatComposer, ChatMessages, titleFrom } from '../../ai'
import { RectoBot, type BotState } from '../../recto-bot'
import { useBotStatus, useBots } from '../hooks/use-bots'
import { parseThread, serialiseThread } from '../threads'
import { BotStatusLine } from './BotStatusLine'

/**
 * A bot's chat. The main chat's turns and composer, under a header with the
 * bot itself - whose face follows the conversation: listening while you type,
 * thinking until the first token, answering while it streams, and a squint
 * when something fails.
 */

type OpenFile = (path: string, heading?: string | null) => void

/** The notes a bot read for an answer, by name, each opening the note. */
function Sources({ sources, onOpen }: { sources: readonly BotSource[]; onOpen: OpenFile }): React.ReactElement | null {
  const notes = sources.filter((s, i) => sources.findIndex((o) => o.path === s.path) === i)
  if (notes.length === 0) return null
  return (
    <div className="bot-sources">
      <span className="bot-sources__label">Sources</span>
      {notes.map((source) => (
        <button
          key={source.path}
          className="bot-sources__note"
          title={source.heading === null ? source.path : `${source.path} › ${source.heading}`}
          onClick={() => onOpen(source.path, source.heading)}
        >
          {source.path.slice(source.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')}
        </button>
      ))}
    </div>
  )
}

function BotChat({
  bot,
  path,
  onTitle,
  onOpen,
}: {
  bot: Bot
  path: string
  onTitle: (title: string) => void
  onOpen: OpenFile
}): React.ReactElement {
  const [messages, setMessages] = useState<BotMessage[]>([])
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [typing, setTyping] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { status, recheck } = useBotStatus(bot.model)
  const scroller = useRef<HTMLDivElement | null>(null)
  /** What the bot read for the reply being streamed, attached to it when it lands. */
  const sources = useRef<BotSource[]>([])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void api.invoke(IPC.fsRead, path).then((result) => {
      if (cancelled) return
      const thread = result.ok ? parseThread(result.content, bot.name) : { title: '', messages: [] }
      setMessages(thread.messages)
      setTitle(thread.title)
      if (thread.title !== '') onTitle(thread.title)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // `onTitle` writes leaf state and changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bot.name])

  const save = useCallback(
    async (next: readonly BotMessage[], nextTitle: string) => {
      await api.invoke(IPC.fsWrite, path, serialiseThread({ title: nextTitle, messages: next }, bot.name))
      noteIndexChanged()
    },
    [path, bot.name],
  )

  const land = useCallback(
    (text: string) => {
      const reply = text.trim()
      if (reply === '') return
      setMessages((prev) => {
        const next: BotMessage[] = [...prev, { role: 'assistant', content: reply, sources: sources.current }]
        void save(next, titleFrom(next))
        return next
      })
    },
    [save],
  )

  useEffect(() => {
    const offDelta = api.on(IPC_EVENT.botsDelta, (delta) => {
      if (delta.id === path) setPending((current) => (current ?? '') + delta.text)
    })
    const offDone = api.on(IPC_EVENT.botsDone, (done) => {
      if (done.id !== path) return
      setPending((current) => {
        land(current ?? '')
        return null
      })
    })
    const offError = api.on(IPC_EVENT.botsError, (failure) => {
      if (failure.id !== path) return
      // Whatever arrived before the failure is kept, as the main chat does.
      setPending((current) => {
        land(current ?? '')
        return null
      })
      setError(failure.message)
      setFailed(true)
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [path, land])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) element.scrollTop = element.scrollHeight
  }, [messages, pending])

  const ready = status?.state === 'ready'

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || pending !== null || !ready) return
    setError(null)
    setFailed(false)
    const next: BotMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setDraft('')
    const nextTitle = titleFrom(next)
    setTitle(nextTitle)
    onTitle(nextTitle)
    await save(next, nextTitle)

    sources.current = []
    setPending('')
    const started = await api.invoke(IPC.botsSend, {
      id: path,
      botId: bot.id,
      messages: next.map(({ role, content }) => ({ role, content })),
    })
    if (started.ok) {
      sources.current = started.sources
      return
    }
    setPending(null)
    setFailed(true)
    // The model went away since the last check: show what to do, not an error.
    if (started.status !== undefined) recheck()
    else setError(started.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, messages, pending, ready, save, path, bot.id])

  const stop = useCallback(() => {
    void api.invoke(IPC.botsCancel, path)
  }, [path])

  const face: BotState = !ready
    ? 'idle'
    : pending === ''
      ? 'thinking'
      : pending !== null
        ? 'answering'
        : failed
          ? 'error'
          : typing && draft.trim() !== ''
            ? 'listening'
            : 'idle'

  const empty = messages.length === 0 && pending === null

  return (
    <div className="chat bot-chat">
      <header className="bot-chat__head">
        <span className="bot-face bot-face--head">
          <RectoBot size={64} look={bot.look} personality={bot.personality} state={face} />
        </span>
        <div className="bot-chat__who">
          <span className="bot-chat__name">{bot.name}</span>
          <span className="bot-chat__specialty">{bot.specialty}</span>
        </div>
      </header>
      <div className="chat__scroll" ref={scroller}>
        <div className="chat__thread">
          {loaded && !ready && <BotStatusLine status={status} onRecheck={recheck} />}
          {loaded && ready && empty && (
            <div className="chat__welcome">
              <h2>Ask {bot.name}</h2>
              <p>
                {bot.name} reads your notes to answer, on a model running on this Mac - nothing leaves it. This thread is a note in{' '}
                <code>chats/{bot.id}/</code>.
              </p>
            </div>
          )}
          <ChatMessages
            messages={messages}
            pending={pending}
            error={error}
            onDismissError={() => setError(null)}
            assistant={bot.name}
            after={(message) =>
              message.role === 'assistant' && message.sources !== undefined ? <Sources sources={message.sources} onOpen={onOpen} /> : null
            }
          />
        </div>
      </div>
      <ChatComposer
        draft={draft}
        onDraft={(text) => {
          setDraft(text)
          setFailed(false)
        }}
        pending={pending !== null}
        onSend={() => void send()}
        onStop={stop}
        disabled={!ready}
        placeholder={ready ? `Ask ${bot.name}…` : `${bot.name} needs the local model to answer`}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
      />
      <span className="chat__title" hidden>
        {title}
      </span>
    </div>
  )
}

/** The view: a bot (by id) and one of its threads (by path). */
export function registerBotView(openFile: OpenFile): () => void {
  return registerView({
    type: 'bot',
    title: 'Bot',
    icon: 'message-square',
    getTitle: (state) => {
      const title = (state as { title?: unknown }).title
      return typeof title === 'string' && title !== '' ? title : 'Bot'
    },
    render: ({ state, setState }) => <BotHost state={state} setState={setState} openFile={openFile} />,
  })
}

function BotHost({
  state,
  setState,
  openFile,
}: {
  state: Record<string, unknown>
  setState: (next: Record<string, unknown>) => void
  openFile: OpenFile
}): React.ReactElement {
  const bots = useBots()
  const bot = bots?.find((b) => b.id === state['bot'])
  const path = state['path']
  if (bots === null) return <div className="pane-empty" />
  if (bot === undefined || typeof path !== 'string') {
    return (
      <div className="pane-empty">
        <p>This bot is no longer in the vault’s .recto/bots folder.</p>
      </div>
    )
  }
  return (
    <BotChat
      bot={bot}
      path={path}
      onOpen={openFile}
      onTitle={(title) => {
        if (state['title'] !== title) setState({ ...state, title })
      }}
    />
  )
}
