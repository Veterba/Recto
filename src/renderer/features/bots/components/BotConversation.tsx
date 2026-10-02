import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AI_MODELS, isAiModel } from '@shared/ai'
import type { Bot, BotSource } from '@shared/bots'
import { fallbackTitle, type TopicMessage } from '@shared/chat-topics'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { registerView } from '../../../app/view-registry'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { ContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { ChatComposer, ChatMessages } from '../../ai'
import { RectoBot, type BotState } from '../../recto-bot'
import { ChatTopics, UNTITLED, type LoadedTopic } from '../chat-topics-model'
import { onNewTopicRequest } from '../new-topic'
import { reloadBots, useBotStatus, useBots } from '../hooks/use-bots'
import { BotStatusLine } from './BotStatusLine'
import { HistoryPanel } from './HistoryPanel'

/**
 * A bot's conversation: one scroll, split into chat topics. Recto's is the app's
 * main chat - the main chat's own turns and composer, rewired.
 *
 * The model only ever sees the current topic (and what the vault search finds
 * for the question); earlier topics stay above, greyed, each under a divider
 * with its title. ⌘N starts a new one. History lists them all.
 */

type OpenFile = (path: string, heading?: string | null) => void

/** The id of the main bot, Recto: the keeper of the vault and the app's main chat. */
export const MAIN_BOT = 'recto'

/** How long a deleted topic can be brought back. */
const UNDO_MS = 6000

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

function useTopics(model: ChatTopics): number {
  return useSyncExternalStore(
    (listener) => model.subscribe(listener),
    () => model.version,
  )
}

/** Local on this Mac always; the API models only while a key is saved. */
function ModelPicker({ bot, defaultModel, keyPresent }: { bot: Bot; defaultModel: string; keyPresent: boolean }): React.ReactElement {
  const chosen = bot.model ?? null
  const api_ = chosen !== null && isAiModel(chosen)
  const localModel = chosen !== null && !api_ ? chosen : defaultModel
  return (
    <select
      className="chat__model"
      aria-label="Model"
      value={api_ && keyPresent ? chosen : 'local'}
      onChange={(event) => {
        const value = event.target.value
        void api.invoke(IPC.botsSetModel, bot.id, value === 'local' ? (api_ ? null : chosen) : value).then(() => reloadBots())
      }}
    >
      <option value="local">Local · {localModel}</option>
      {keyPresent &&
        AI_MODELS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
    </select>
  )
}

function TopicBlock({
  topic,
  past,
  bot,
  pending,
  error,
  onDismissError,
  onOpen,
}: {
  topic: LoadedTopic
  past: boolean
  bot: Bot
  pending: string | null
  error: string | null
  onDismissError: () => void
  onOpen: OpenFile
}): React.ReactElement {
  return (
    <section className={`chat-topic${past ? ' is-past' : ''}`} data-topic={topic.path}>
      <div className="chat-topic__divider" role="separator">
        <span>New topic · {topic.meta.title}</span>
      </div>
      <ChatMessages<TopicMessage>
        messages={topic.messages}
        pending={pending}
        error={error}
        onDismissError={onDismissError}
        assistant={bot.name}
        labelOf={(message) => message.label}
        after={(message) =>
          message.role === 'assistant' && message.sources !== undefined ? <Sources sources={message.sources} onOpen={onOpen} /> : null
        }
      />
    </section>
  )
}

function Conversation({ bot, onOpen }: { bot: Bot; onOpen: OpenFile }): React.ReactElement {
  const model = useMemo(() => new ChatTopics(bot, bot.id === MAIN_BOT ? [bot.name, 'Claude'] : [bot.name]), [bot.id, bot.name])
  useTopics(model)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [typing, setTyping] = useState(false)
  const [history, setHistory] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [undo, setUndo] = useState<{ title: string; run: () => Promise<void> } | null>(null)
  const [keyPresent, setKeyPresent] = useState(false)
  const [defaultModel, setDefaultModel] = useState('')
  const { status, recheck } = useBotStatus(bot.model)
  const scroller = useRef<HTMLDivElement | null>(null)
  const top = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)

  /** The reply being streamed, and the topic it belongs to: refs, read by the stream's handlers directly. */
  const pendingRef = useRef<string | null>(null)
  const streamPath = useRef<string | null>(null)
  const sources = useRef<BotSource[]>([])
  const setStream = useCallback((next: string | null) => {
    pendingRef.current = next
    setPending(next)
  }, [])

  useEffect(() => {
    void model.refresh()
    void api.invoke(IPC.aiKeyStatus).then((s) => setKeyPresent(s.present))
    void api.invoke(IPC.botsSettings).then((s) => setDefaultModel(s.defaultModel))
  }, [model])

  useEffect(() => onNewTopicRequest(bot.id, () => model.startNew()), [bot.id, model])

  /** After a topic's first exchange, the model names it (or its first question does). */
  const nameTopic = useCallback(
    async (path: string) => {
      const topic = model.loaded.get(path)
      if (topic === undefined || topic.meta.title !== UNTITLED || topic.messages.length < 2) return
      // From the first exchange only: that is what the topic was opened for.
      const plain = topic.messages.slice(0, 2).map(({ role, content }) => ({ role, content }))
      const title = (await api.invoke(IPC.botsTitle, { botId: bot.id, messages: plain })) ?? fallbackTitle(topic.messages)
      await model.retitle(path, title)
    },
    [model, bot.id],
  )

  /** The stream ended: whatever arrived becomes one answer in its topic, saved once. */
  const land = useCallback(async () => {
    const reply = (pendingRef.current ?? '').trim()
    const path = streamPath.current
    setStream(null)
    streamPath.current = null
    if (reply === '' || path === null) return
    if (model.current !== path) await model.select(path)
    await model.append({ role: 'assistant', content: reply, sources: sources.current })
    await nameTopic(path)
  }, [model, nameTopic, setStream])

  useEffect(() => {
    const offDelta = api.on(IPC_EVENT.botsDelta, (delta) => {
      if (delta.id === streamPath.current) setStream((pendingRef.current ?? '') + delta.text)
    })
    const offDone = api.on(IPC_EVENT.botsDone, (done) => {
      if (done.id === streamPath.current) void land()
    })
    const offError = api.on(IPC_EVENT.botsError, (failure) => {
      if (failure.id !== streamPath.current) return
      void land()
      setError(failure.message)
      setFailed(true)
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [land, setStream])

  const ready = status?.state === 'ready'

  // A topic left untitled - the app closed before its title came back - is
  // named the next time it is opened with the model available.
  useEffect(() => {
    if (ready && model.ready && model.current !== null) void nameTopic(model.current)
  }, [ready, model, model.ready, model.current, nameTopic])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || pendingRef.current !== null || !ready) return
    setError(null)
    setFailed(false)
    setDraft('')
    const path = await model.append({ role: 'user', content: text })
    if (path === null) return
    // The model sees this topic and nothing before it.
    const messages = (model.loaded.get(path)?.messages ?? []).map(({ role, content }) => ({ role, content }))
    sources.current = []
    streamPath.current = path
    setStream('')
    const started = await api.invoke(IPC.botsSend, { id: path, botId: bot.id, messages })
    if (started.ok) {
      sources.current = started.sources
      return
    }
    streamPath.current = null
    setStream(null)
    setFailed(true)
    if (started.status !== undefined) recheck()
    else setError(started.error)
  }, [draft, ready, model, bot.id, recheck, setStream])

  const stop = useCallback(() => {
    if (streamPath.current !== null) void api.invoke(IPC.botsCancel, streamPath.current)
  }, [])

  // A conversation opens at its latest message; after that, the newest text
  // stays in view unless the user has scrolled up to read.
  // "At the bottom" is what the user last scrolled to, not a distance measured
  // now: the status line or a longer answer changes the distance without the
  // user moving. The first topics loaded (version 1) open at the bottom.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && model.version > 0 && pinned.current) element.scrollTop = element.scrollHeight
  }, [model.version, pending, status])

  // Older topics load when the top of the scroll comes into view; the reading position is kept.
  useEffect(() => {
    const element = top.current
    const box = scroller.current
    if (element === null || box === null) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || !model.hasOlder()) return
      const before = box.scrollHeight - box.scrollTop
      void model.loadOlder().then(() => requestAnimationFrame(() => (box.scrollTop = box.scrollHeight - before)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [model, model.ready])

  const jumpTo = useCallback(
    async (path: string) => {
      await model.select(path)
      setHistory(false)
      requestAnimationFrame(() => {
        scroller.current?.querySelector(`[data-topic="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'start' })
        composer.current?.focus()
      })
    },
    [model],
  )

  const remove = useCallback(
    async (path: string) => {
      const title = model.loaded.get(path)?.meta.title ?? 'Topic'
      const restore = await model.remove(path)
      setUndo({ title, run: restore })
    },
    [model],
  )

  useEffect(() => {
    if (undo === null) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

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

  const visible = model.visible()
  const menuItems: MenuItem[] = [
    {
      kind: 'item',
      label: 'Clear all',
      icon: 'trash',
      danger: true,
      disabled: model.files.length === 0,
      run: () => setConfirmClear(true),
    },
  ]

  return (
    <div
      className="chat bot-chat"
      onKeyDownCapture={(event) => {
        // ⌘N in a chat is a new topic, typed in the composer or not.
        if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
          event.preventDefault()
          event.stopPropagation()
          model.startNew()
          composer.current?.focus()
        }
      }}
    >
      <header className="bot-chat__head">
        <span className="bot-face bot-face--head">
          <RectoBot size={64} look={bot.look} personality={bot.personality} state={face} />
        </span>
        <div className="bot-chat__who">
          <span className="bot-chat__name">{bot.name}</span>
          <span className="bot-chat__specialty">{bot.specialty}</span>
        </div>
        <div className="bot-chat__actions">
          <Tip label="New topic" hint="⌘N">
            <button
              className="bot-chat__action"
              onClick={() => {
                model.startNew()
                composer.current?.focus()
              }}
            >
              <Icon name="plus" size={14} />
              <span>New topic</span>
            </button>
          </Tip>
          <button className={`bot-chat__action${history ? ' is-on' : ''}`} aria-pressed={history} onClick={() => setHistory((on) => !on)}>
            <Icon name="history" size={14} />
            <span>History</span>
          </button>
          <button
            className="bot-chat__action bot-chat__action--icon"
            aria-label="More"
            onClick={(event) => {
              const r = event.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right - 180, y: r.bottom + 4 })
            }}
          >
            <Icon name="more-horizontal" size={15} />
          </button>
        </div>
      </header>

      {history && (
        <HistoryPanel
          model={model}
          current={model.current}
          onJump={(path) => void jumpTo(path)}
          onDelete={(path) => void remove(path)}
          onClose={() => setHistory(false)}
        />
      )}

      <div
        className="chat__scroll"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
      >
        <div className="chat__thread">
          <div ref={top} className="chat-topic__top" aria-hidden="true" />
          {visible.map((path) => {
            const topic = model.loaded.get(path)
            if (topic === undefined) return null
            const isCurrent = path === model.current
            return (
              <TopicBlock
                key={path}
                topic={topic}
                past={!isCurrent}
                bot={bot}
                pending={isCurrent && streamPath.current === path ? pending : null}
                error={isCurrent ? error : null}
                onDismissError={() => setError(null)}
                onOpen={onOpen}
              />
            )
          })}
          {model.ready && model.current === null && (
            <section className="chat-topic">
              <div className="chat-topic__divider" role="separator">
                <span>New topic</span>
              </div>
              {ready && model.files.length === 0 && (
                <div className="chat__welcome">
                  <h2>Ask {bot.name}</h2>
                  <p>
                    {bot.name} reads your notes to answer. Each topic is a note in <code>chats/{bot.id}/</code>.
                  </p>
                </div>
              )}
              {error !== null && (
                <p className="chat__error" role="alert" onClick={() => setError(null)}>
                  {error}
                </p>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Above the composer, not in the scroll: why Send is off must be in view however far down the conversation is. */}
      {status !== null && !ready && (
        <div className="bot-chat__status">
          <BotStatusLine status={status} onRecheck={recheck} />
        </div>
      )}

      <ChatComposer
        inputRef={composer}
        draft={draft}
        onDraft={(text) => {
          setDraft(text)
          setFailed(false)
        }}
        pending={pending !== null}
        onSend={() => void send()}
        onStop={stop}
        disabled={!ready}
        placeholder={ready ? `Ask ${bot.name}…` : `${bot.name} needs its model to answer`}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        tools={bot.id === MAIN_BOT ? <ModelPicker bot={bot} defaultModel={defaultModel} keyPresent={keyPresent} /> : undefined}
      />

      {undo !== null && (
        <div className="bot-undo" role="status">
          <span>Deleted “{undo.title}”</span>
          <button
            onClick={() => {
              const run = undo.run
              setUndo(null)
              void run()
            }}
          >
            Undo
          </button>
        </div>
      )}

      {menu !== null && <ContextMenu items={menuItems} at={menu} onClose={() => setMenu(null)} />}

      {confirmClear && (
        <ConfirmDialog
          title="Clear all topics"
          body={
            <>
              All {model.files.length} {model.files.length === 1 ? 'topic' : 'topics'} with {bot.name} go to the system trash.
            </>
          }
          confirmLabel={`Delete ${model.files.length} ${model.files.length === 1 ? 'topic' : 'topics'}`}
          onConfirm={() => {
            setConfirmClear(false)
            void model.clearAll()
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}

/** The view: one bot's conversation. Recto's is the main chat; the old `chat` view opens it too. */
export function registerBotView(openFile: OpenFile): () => void {
  const render = ({ state }: { state: Record<string, unknown> }): React.ReactElement => (
    <BotHost botId={typeof state['bot'] === 'string' ? state['bot'] : MAIN_BOT} openFile={openFile} />
  )
  const offBot = registerView({ type: 'bot', title: 'Recto', icon: 'message-square', getTitle: (state) => botTitle(state), render })
  // Layouts saved before Recto became the main chat have `chat` tabs; they open Recto.
  const offChat = registerView({ type: 'chat', title: 'Recto', icon: 'message-square', getTitle: () => 'Recto', render })
  return () => {
    offBot()
    offChat()
  }
}

const botTitle = (state: Record<string, unknown>): string => {
  const id = state['bot']
  return typeof id === 'string' && id !== MAIN_BOT ? id : 'Recto'
}

function BotHost({ botId, openFile }: { botId: string; openFile: OpenFile }): React.ReactElement {
  const bots = useBots()
  const bot = bots?.find((b) => b.id === botId)
  if (bots === null) return <div className="pane-empty" />
  if (bot === undefined) {
    return (
      <div className="pane-empty">
        <p>This bot is no longer in the vault’s .recto/bots folder.</p>
      </div>
    )
  }
  return <Conversation key={bot.id} bot={bot} onOpen={openFile} />
}
