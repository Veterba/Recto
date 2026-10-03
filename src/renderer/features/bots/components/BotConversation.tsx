import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Bot, BotMessage, BotSource, PullProgress } from '@shared/bots'
import { createdStamp, fallbackTitle } from '@shared/chat-topics'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../../../app/api'
import { registerView } from '../../../app/view-registry'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { ContextMenu, type MenuItem } from '../../../ui/ContextMenu'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { RectoBot, type BotState } from '../../recto-bot'
import { ChatTopics, UNTITLED } from '../chat-topics-model'
import { onNewTopicRequest } from '../new-topic'
import { reloadBots, useBotStatus, useBots } from '../hooks/use-bots'
import { markRead, markUnread } from '../unread'
import { BotStatusLine } from './BotStatusLine'
import { Composer, type NoteCandidate } from './Composer'
import { HistoryPanel } from './HistoryPanel'
import { TopicBlock, TopicDivider, type MessageActions, type Pending } from './Messages'
import { ModelMenu, modelLabel } from './ModelMenu'

/**
 * A bot's conversation, in chat topics, read like a messenger - with a
 * floating composer over its bottom. Recto's is the app's main chat.
 *
 * The page shows the current topic alone, and the model only ever sees it
 * (and what the vault search finds for the question). ⌘N starts a new one on
 * a clean page, like a new chat; History lists them all and opens any.
 */

type OpenFile = (path: string, heading?: string | null) => void

/** The id of the main bot, Recto: the keeper of the vault and the app's main chat. */
export const MAIN_BOT = 'recto'

/** How long a deleted topic can be brought back. */
const UNDO_MS = 6000
/** How long the face's "found it" beat lasts before it reads the answer out. */
const FOUND_MS = 400

const noteTitle = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

function useTopics(model: ChatTopics): number {
  return useSyncExternalStore(
    (listener) => model.subscribe(listener),
    () => model.version,
  )
}

function Conversation({ bot, onOpen, notes }: { bot: Bot; onOpen: OpenFile; notes: () => readonly NoteCandidate[] }): React.ReactElement {
  const model = useMemo(() => new ChatTopics(bot, bot.id === MAIN_BOT ? [bot.name, 'Claude'] : [bot.name]), [bot.id, bot.name])
  useTopics(model)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [history, setHistory] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [undo, setUndo] = useState<{ title: string; run: () => Promise<void> } | null>(null)
  const [keyPresent, setKeyPresent] = useState(false)
  const [defaultModel, setDefaultModel] = useState('')
  const [pull, setPull] = useState<(PullProgress & { error?: string }) | null>(null)
  /** What the bot is doing before its first word ("Checking your tasks…"). */
  const [progress, setProgress] = useState<string | null>(null)
  const { status, recheck } = useBotStatus(bot.model)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const seen = useRef(true)

  /** The answer being streamed, and the topic it belongs to: refs, read by the stream's handlers directly. */
  const pendingRef = useRef<Pending | null>(null)
  const streamPath = useRef<string | null>(null)
  const timing = useRef({ sent: 0, first: 0 })
  const setStream = useCallback((next: Pending | null) => {
    pendingRef.current = next
    setPending(next)
  }, [])

  /** The model this bot answers with now. */
  const current = bot.model !== undefined && bot.model !== '' ? bot.model : defaultModel

  useEffect(() => {
    void model.refresh()
    void api.invoke(IPC.aiKeyStatus).then((s) => setKeyPresent(s.present))
    void api.invoke(IPC.botsSettings).then((s) => setDefaultModel(s.defaultModel))
  }, [model])

  useEffect(() => onNewTopicRequest(bot.id, () => model.startNew()), [bot.id, model])

  // Seen or not: an answer that lands out of sight puts a dot on the bot's row.
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const observer = new IntersectionObserver((entries) => {
      seen.current = entries.some((e) => e.isIntersecting)
      if (seen.current) markRead(bot.id)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [bot.id])

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

  /** The stream ended: whatever arrived becomes one answer in its topic, saved once, with what is known about it. */
  const land = useCallback(async () => {
    const answer = pendingRef.current
    const path = streamPath.current
    setStream(null)
    streamPath.current = null
    setProgress(null)
    const reply = (answer?.text ?? '').trim()
    if (answer === null || reply === '' || path === null) return
    if (model.current !== path) await model.select(path)
    const { sent, first } = timing.current
    const turn: BotMessage = {
      role: 'assistant',
      content: reply,
      at: answer.at,
      model: current,
      sources: answer.sources,
      ...(answer.steps.length > 0 ? { steps: answer.steps } : {}),
      ...(first > 0 ? { ttftMs: Math.round(first - sent) } : {}),
      totalMs: Math.round(performance.now() - sent),
    }
    await model.append(turn)
    if (!seen.current || document.visibilityState !== 'visible') markUnread(bot.id)
    await nameTopic(path)
  }, [model, nameTopic, setStream, current, bot.id])

  useEffect(() => {
    let found = 0
    const offDelta = api.on(IPC_EVENT.botsDelta, (delta) => {
      const now = pendingRef.current
      if (delta.id !== streamPath.current || now === null) return
      if (now.text === '') {
        setProgress(null)
        // The first token: the face's "found it" beat, then it reads the answer out.
        timing.current.first = performance.now()
        window.clearTimeout(found)
        found = window.setTimeout(() => {
          if (pendingRef.current !== null) setStream({ ...pendingRef.current, face: 'answering' })
        }, FOUND_MS)
        setStream({ ...now, text: delta.text, face: 'found' })
      } else setStream({ ...now, text: now.text + delta.text })
    })
    const offProgress = api.on(IPC_EVENT.botsProgress, (event) => {
      if (event.id === streamPath.current && pendingRef.current?.text === '') setProgress(event.text)
    })
    const offDone = api.on(IPC_EVENT.botsDone, (done) => {
      if (done.id === streamPath.current) void land()
    })
    const offError = api.on(IPC_EVENT.botsError, (failure) => {
      if (failure.id !== streamPath.current) return
      void land()
      setError(failure.message)
    })
    return () => {
      window.clearTimeout(found)
      offDelta()
      offProgress()
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

  /** Ask for an answer to the current topic as it stands. */
  const ask = useCallback(
    async (path: string) => {
      // The model sees this topic and nothing before it.
      const messages = (model.loaded.get(path)?.messages ?? []).map(({ role, content }) => ({ role, content }))
      streamPath.current = path
      timing.current = { sent: performance.now(), first: 0 }
      setStream({ text: '', steps: [], sources: [], face: 'riffle', at: createdStamp(new Date()) })
      const started = await api.invoke(IPC.botsSend, { id: path, botId: bot.id, messages })
      if (started.ok) {
        if (pendingRef.current !== null) setStream({ ...pendingRef.current, sources: started.sources })
        return
      }
      streamPath.current = null
      setStream(null)
      if (started.status !== undefined) recheck()
      else setError(started.error)
    },
    [model, bot.id, recheck, setStream],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || pendingRef.current !== null || !ready) return
    setError(null)
    setDraft('')
    const path = await model.append({ role: 'user', content: text })
    if (path !== null) await ask(path)
  }, [draft, ready, model, ask])

  const stop = useCallback(() => {
    if (streamPath.current !== null) void api.invoke(IPC.botsCancel, streamPath.current)
  }, [])

  const actions: MessageActions = {
    onOpen,
    onOpenNote: (title: string, sources: readonly BotSource[]) => {
      const source = sources.find((s) => noteTitle(s.path).toLowerCase() === title.toLowerCase())
      if (source !== undefined) onOpen(source.path, source.heading)
      else
        void api.invoke(IPC.indexResolveLink, title).then((resolved) => {
          if (resolved !== null) onOpen(resolved)
        })
    },
  }

  // Model downloads: progress in the status line; a finished one becomes the bot's model.
  const pick = useCallback(
    (name: string) => {
      void api.invoke(IPC.botsSetModel, bot.id, name).then(() => {
        reloadBots()
        recheck()
      })
    },
    [bot.id, recheck],
  )
  useEffect(
    () =>
      api.on(IPC_EVENT.botsPullProgress, (progress) => {
        if (!progress.done) setPull(progress)
        else if (progress.status === 'success') {
          setPull(null)
          pick(progress.name)
        } else setPull(progress.error === undefined ? null : progress)
      }),
    [pick],
  )

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

  const jumpTo = useCallback(
    async (path: string) => {
      // The topic replaces the page, opened at its latest message.
      pinned.current = true
      await model.select(path)
      setHistory(false)
      requestAnimationFrame(() => composer.current?.focus())
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

  const newTopic = (): void => {
    model.startNew()
    composer.current?.focus()
  }

  const face: BotState = !ready
    ? 'idle'
    : pending !== null
      ? pending.face
      : error !== null
        ? 'error'
        : typing && draft.trim() !== ''
          ? 'listening'
          : 'idle'

  const visible = model.visible()
  const currentTitle = model.currentTopic()?.meta.title
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

  // One muted line above the composer: a download, or why Send is off.
  const statusLine =
    pull !== null ? (
      <p className={`composer__status${pull.error !== undefined ? ' is-error' : ''}`}>
        <span className="composer__dot" aria-hidden="true" />
        {pull.error !== undefined
          ? `Couldn’t download ${modelLabel(pull.name)}: ${pull.error}`
          : `Downloading ${modelLabel(pull.name)}${pull.total > 0 ? ` · ${Math.floor((pull.completed / pull.total) * 100)}%` : '…'}`}
        <button
          className="composer__link"
          onClick={() => {
            if (pull.error === undefined) void api.invoke(IPC.botsPullCancel)
            setPull(null)
          }}
        >
          {pull.error === undefined ? 'Cancel' : 'Dismiss'}
        </button>
      </p>
    ) : progress !== null && pending !== null ? (
      <p className="composer__status" aria-live="polite">
        {progress}
      </p>
    ) : status !== null && !ready ? (
      <BotStatusLine status={status} onRecheck={recheck} compact />
    ) : null

  return (
    <div
      ref={root}
      className="chat bot-chat"
      onKeyDownCapture={(event) => {
        // ⌘N in a chat is a new topic, typed in the composer or not.
        if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
          event.preventDefault()
          event.stopPropagation()
          newTopic()
        }
      }}
    >
      <header className="bot-chat__head">
        <span className="bot-face bot-face--head">
          <RectoBot id={bot.id} size={64} look={bot.look} personality={bot.personality} state={face} />
        </span>
        <div className="bot-chat__who">
          <span className="bot-chat__name">{bot.name}</span>
          <span className="bot-chat__specialty">
            {currentTitle !== undefined && currentTitle !== UNTITLED ? currentTitle : bot.specialty.replace(/\.$/, '')}
            {current !== '' && <> · {modelLabel(current)}</>}
          </span>
        </div>
        <div className="bot-chat__actions">
          <Tip label="New topic" hint="⌘N">
            <button className="bot-chat__action" onClick={newTopic}>
              <Icon name="plus" size={14} />
              <span>New topic</span>
            </button>
          </Tip>
          <button
            className={`bot-chat__action${history ? ' is-on' : ''}`}
            aria-pressed={history}
            data-history-toggle=""
            onClick={() => setHistory((on) => !on)}
          >
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
          {visible.map((path) => {
            const topic = model.loaded.get(path)
            if (topic === undefined) return null
            return (
              <TopicBlock
                key={path}
                topic={topic}
                bot={bot}
                pending={streamPath.current === path ? pending : null}
                error={error}
                onDismissError={() => setError(null)}
                actions={actions}
                face={face}
              />
            )
          })}
          {model.ready && model.current === null && (
            <section className="chat-topic">
              <TopicDivider title={null} />
              {ready && (
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

      <Composer
        inputRef={composer}
        draft={draft}
        onDraft={(text) => {
          setDraft(text)
          if (error !== null && pending === null) setError(null)
        }}
        placeholder={`Ask ${bot.name}…`}
        busy={pending !== null}
        canSend={ready}
        onSend={() => void send()}
        onStop={stop}
        onNewTopic={newTopic}
        status={statusLine}
        model={current}
        notes={notes}
        modelMenu={(close) => (
          <ModelMenu
            current={current}
            keyPresent={keyPresent}
            pulling={pull !== null && pull.error === undefined ? pull.name : null}
            onPick={(name) => {
              close()
              if (name !== current) pick(name)
            }}
            onDownload={(name) => {
              void api.invoke(IPC.botsPull, name).then((started) => {
                if (!started.ok) setPull({ name, status: 'error', completed: 0, total: 0, error: started.error ?? 'failed' })
              })
            }}
            onClose={close}
          />
        )}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
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
export function registerBotView(openFile: OpenFile, notes: () => readonly NoteCandidate[]): () => void {
  const render = ({ state }: { state: Record<string, unknown> }): React.ReactElement => (
    <BotHost botId={typeof state['bot'] === 'string' ? state['bot'] : MAIN_BOT} openFile={openFile} notes={notes} />
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

function BotHost({
  botId,
  openFile,
  notes,
}: {
  botId: string
  openFile: OpenFile
  notes: () => readonly NoteCandidate[]
}): React.ReactElement {
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
  return <Conversation key={bot.id} bot={bot} onOpen={openFile} notes={notes} />
}
