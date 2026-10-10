import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Bot, BotSource, PullProgress } from '@shared/bots'
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
import { onNewTopicRequest, onTopicRequest } from '../new-topic'
import { reloadBots, useBotStatus, useBots } from '../hooks/use-bots'
import { markRead } from '../unread'
import { isActive } from '@shared/bots'
import { jobForTopic, ordinal, topicJobs, useJobs } from '../jobs-store'
import { statusPhrases } from '@shared/bot-status'
import { StatusText, useStatusText } from './BotStatus'
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
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [history, setHistory] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [undo, setUndo] = useState<{ title: string; run: () => Promise<void> } | null>(null)
  const [keyPresent, setKeyPresent] = useState(false)
  const [defaultModel, setDefaultModel] = useState('')
  const [pull, setPull] = useState<(PullProgress & { error?: string }) | null>(null)
  const { status, recheck } = useBotStatus(bot.model)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const seen = useRef(true)

  /** The model this bot answers with now. */
  const current = bot.model !== undefined && bot.model !== '' ? bot.model : defaultModel

  useEffect(() => {
    void model.refresh()
    void api.invoke(IPC.aiKeyStatus).then((s) => setKeyPresent(s.present))
    void api.invoke(IPC.botsSettings).then((s) => setDefaultModel(s.defaultModel))
  }, [model])

  useEffect(() => onNewTopicRequest(bot.id, () => model.startNew()), [bot.id, model])
  useEffect(() => onTopicRequest(bot.id, (path) => void model.select(path)), [bot.id, model])

  // Seen or not, and which topic: main decides from this whether a finished answer
  // gets a notification and the bot's row a dot.
  const viewing = useRef<() => void>(() => undefined)
  viewing.current = () =>
    void api.invoke(IPC.botsViewing, {
      botId: bot.id,
      topic: model.current,
      visible: seen.current && document.visibilityState === 'visible',
    })
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const observer = new IntersectionObserver((entries) => {
      seen.current = entries.some((e) => e.isIntersecting)
      if (seen.current) markRead(bot.id)
      viewing.current()
    })
    observer.observe(element)
    const report = (): void => viewing.current()
    document.addEventListener('visibilitychange', report)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', report)
      void api.invoke(IPC.botsViewing, { botId: bot.id, topic: null, visible: false })
    }
  }, [bot.id])
  useEffect(() => viewing.current(), [model.current])

  // The answer for the topic on screen is main's job; this only watches it.
  useJobs()
  const job = jobForTopic(model.current)
  const live = job !== null && isActive(job) ? job : null
  // The face's "found it" beat on an answer's first text, then it reads the answer out.
  const [found, setFound] = useState<string | null>(null)
  const firstText = live !== null && live.text !== '' ? live.id : null
  const beat = useRef<string | null>(null)
  useEffect(() => {
    if (firstText === null || beat.current === firstText) return
    beat.current = firstText
    setFound(firstText)
    const timer = window.setTimeout(() => setFound(null), FOUND_MS)
    return () => window.clearTimeout(timer)
  }, [firstText])
  // What it is doing, from its steps: beside the face and in the header.
  const statusText = useStatusText(live === null ? null : statusPhrases(live))
  const pending: Pending | null =
    live === null || live.state === 'queued'
      ? null
      : {
          text: live.text,
          steps: live.steps,
          sources: live.sources,
          face: live.text === '' ? 'riffle' : found === live.id ? 'found' : 'answering',
          at: live.at,
          status: statusText,
        }

  /** After a topic's first exchange, the model names it (or its first question does). */
  const nameTopic = useCallback(
    async (path: string) => {
      const topic = model.loaded.get(path)
      // Not while main writes to it: a rename would pull the file from under the answer.
      const running = jobForTopic(path)
      if (topic === undefined || topic.meta.title !== UNTITLED || topic.messages.length < 2 || (running !== null && isActive(running)))
        return
      // From the first exchange only: that is what the topic was opened for.
      const plain = topic.messages.slice(0, 2).map(({ role, content }) => ({ role, content }))
      const title = (await api.invoke(IPC.botsTitle, { botId: bot.id, messages: plain })) ?? fallbackTitle(topic.messages)
      await model.retitle(path, title)
    },
    [model, bot.id],
  )

  // A job that ends, or starts (a waiting question goes into the file): read the topic again.
  const stage = job === null ? null : `${job.id}:${isActive(job) ? (job.question === null ? 'written' : 'waiting') : job.state}`
  useEffect(() => {
    if (job === null || stage === null) return
    void model.reload(job.topic).then(() => {
      if (!isActive(job)) void nameTopic(job.topic)
    })
    if (job.state === 'error' && job.error !== null) setError(job.error)
    // Only when the stage changes; the job object changes with every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const ready = status?.state === 'ready'

  // A topic left untitled - the app closed before its title came back - is
  // named the next time it is opened with the model available.
  useEffect(() => {
    if (ready && model.ready && model.current !== null) void nameTopic(model.current)
  }, [ready, model, model.ready, model.current, nameTopic])

  /** A question: main writes it into the topic (a new one if none is open) and queues the answer. */
  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || !ready) return
    setError(null)
    setDraft('')
    const result = await api.invoke(IPC.botsSend, { botId: bot.id, topic: model.current, text, at: createdStamp(new Date()) })
    if (!result.ok) {
      setDraft(text)
      if (result.status !== undefined) recheck()
      else setError(result.error)
      return
    }
    pinned.current = true
    if (model.current === result.topic) await model.reload(result.topic)
    else await model.adopt(result.topic)
  }, [draft, ready, model, bot.id, recheck])

  /** Stop: the answer running in this topic (a question waiting behind it stays). */
  const stop = useCallback(() => {
    const running = topicJobs(model.current).find((j) => j.state === 'preparing' || j.state === 'streaming')
    if (running !== undefined) void api.invoke(IPC.botsCancel, { id: running.id })
  }, [model])

  const actions: MessageActions = {
    ...(live === null && model.current !== null
      ? { onRetry: () => void api.invoke(IPC.botsRetry, { botId: bot.id, topic: model.current! }) }
      : {}),
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
      // An answer running or waiting in it stops first, and writes nothing more.
      await api.invoke(IPC.botsCancel, { topic: path }, true)
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
    ) : live !== null && live.state === 'queued' ? (
      <p className="composer__status" aria-live="polite">
        {topicJobs(live.topic).some((j) => j.state === 'preparing' || j.state === 'streaming') ? (
          <>
            {bot.name} is still answering
            <button className="composer__link" onClick={stop}>
              Stop
            </button>
          </>
        ) : (
          <>
            Queued · {ordinal(live.position + 1)}
            <button className="composer__link" onClick={() => void api.invoke(IPC.botsCancel, { id: live.id })}>
              Cancel
            </button>
          </>
        )}
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
          {pending?.status != null ? (
            <span className="bot-chat__specialty">
              <StatusText text={pending.status} />
            </span>
          ) : (
            <span className="bot-chat__specialty">
              {currentTitle !== undefined && currentTitle !== UNTITLED ? currentTitle : bot.specialty.replace(/\.$/, '')}
              {current !== '' && <> · {modelLabel(current)}</>}
            </span>
          )}
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
            const loaded = model.loaded.get(path)
            if (loaded === undefined) return null
            // What main has written of the answer so far is shown live instead; a question still
            // waiting behind the running answer is shown as sent.
            const messages = loaded.messages.filter((m) => !(live !== null && m.job === live.id))
            if (live !== null && live.question !== null) messages.push({ role: 'user', content: live.question, at: live.at })
            const topic = { ...loaded, messages }
            return (
              <TopicBlock
                key={path}
                topic={topic}
                bot={bot}
                pending={pending}
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
        busy={pending !== null && draft.trim() === ''}
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
            void (async () => {
              for (const path of model.files) await api.invoke(IPC.botsCancel, { topic: path }, true)
              await model.clearAll()
            })()
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
