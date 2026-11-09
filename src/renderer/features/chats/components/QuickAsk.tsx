import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { claimsPendingEdit, type AnswerRecord } from '@shared/answer-record'
import type { BotMessage, BotStep } from '@shared/bots'
import { createdStamp } from '@shared/chat-topics'
import { IPC, IPC_EVENT } from '@shared/ipc'
import type { ProviderProblem } from '@shared/providers'
import { api } from '../../../app/api'
import type { BotPlace } from '../../../app/appearance'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { Markdown, ModelChip, ModelMenu, ProblemLine, requestTopic, StepsCard } from '../../bots'
import { useBotStatus } from '../../bots/hooks/use-bots'
import { openSuggestedEdits } from '../../suggested-edits'
import { openChats } from '../chats-store'
import { BOT_SIZE, pointOf, useBotArea, type BotArea } from './FloatingBot'
import { useBotMotion } from '../bot-motion'
import { canvasSelection, useCanvasSelection } from '../../../app/canvas-selection'
import { takeQuickAsk, useQuickAskRequest } from '../../../app/quick-ask-request'

/**
 * Quick ask: short questions about the note open right now, in a bubble
 * that comes out of the floating bot - not a chat. Every question goes with that note (and a
 * budgeted summary of its links); open another note and the next question is
 * about that one, with a quiet "About: …" line where it changed. The thread
 * lives in this window only: closing it, or quitting, forgets it, and it is
 * never in the chat list or History - unless "Save as chat" makes it a
 * normal chat with Recto. Edits it suggests can only be to the open note.
 */

type Turn = {
  role: 'user' | 'assistant'
  content: string
  /** The note the question was about. */
  note: string
  at: string
  model?: string
  steps?: BotStep[]
  sources?: string[]
  /** What the answer really read and suggested: goes back with later questions. */
  record?: AnswerRecord
  problem?: ProviderProblem
  /** Still answering. */
  live?: boolean
}

const MODEL_KEY = 'recto.quickAskModel'
const lastModel = (): string | null => {
  try {
    return localStorage.getItem(MODEL_KEY)
  } catch {
    return null
  }
}

const titleOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')
const isCanvas = (path: string | null): boolean => path !== null && path.toLowerCase().endsWith('.canvas')

/** Room kept between the bubble, the bot and the area's edges. */
const GAP = 10
const WIDTH = 372

type Props = {
  /** The note open in the editor, or null. */
  note: string | null
  /** Where the bot is: the bubble opens beside it, towards the middle of the area. */
  place: BotPlace
  /** The bot is shown: the bubble points at it. */
  pointing: boolean
  /** The workspace area it floats over. */
  area: React.RefObject<HTMLElement | null>
  openFile: (path: string) => void
  onClose: () => void
}

/** The bubble's position and size, beside the bot (`at`: where it is while dragged, else its place): above it in the lower half of the area, below it in the upper; lined up with its outer side. */
export function bubbleAt(
  place: BotPlace,
  area: BotArea,
  at: { x: number; y: number } | null = null,
): { style: React.CSSProperties; above: boolean; right: boolean } {
  const bot = at ?? pointOf(place, area)
  const above = bot.y + BOT_SIZE / 2 > area.top + area.height / 2
  const right = bot.x + BOT_SIZE / 2 > area.width / 2
  const width = Math.min(WIDTH, area.width - 2 * GAP)
  const style: React.CSSProperties = {
    width,
    maxHeight: Math.max(160, above ? bot.y - area.top - 2 * GAP : area.top + area.height - bot.y - BOT_SIZE - 2 * GAP),
    ...(above ? { bottom: area.top + area.height + area.below - bot.y + GAP } : { top: bot.y + BOT_SIZE + GAP }),
    ...(right ? { right: Math.max(GAP, area.width - bot.x - BOT_SIZE) } : { left: Math.max(GAP, bot.x) }),
  }
  return { style, above, right }
}

export function QuickAsk({ note, place, pointing, area, openFile, onClose }: Props): React.ReactElement {
  const [thread] = useState(() => `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<string | null>(lastModel)
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const { status, recheck } = useBotStatus(model ?? undefined)
  const live = turns.at(-1)?.live === true

  // No model picked yet: the bots' default, the one on this Mac.
  useEffect(() => {
    if (model === null) void api.invoke(IPC.botsSettings).then((s) => setModel(s.defaultModel))
  }, [model])

  // Where the bot may stand, so the bubble lines up with it.
  const size = useBotArea(() => area.current)

  // Focused once it shows: the bubble is hidden until the bot's area is
  // measured, and a hidden field takes no focus - typing went into the note.
  const shown = size.width > 0
  useEffect(() => {
    if (shown) input.current?.focus()
  }, [shown])

  // The answer as it streams.
  useEffect(
    () =>
      api.on(IPC_EVENT.quickAskEvent, (event) => {
        if (event.thread !== thread) return
        setTurns((prev) => {
          const last = prev.at(-1)
          if (last === undefined || last.role !== 'assistant' || last.live !== true) return prev
          const next: Turn =
            event.type === 'text'
              ? { ...last, content: last.content + event.text }
              : event.type === 'steps'
                ? { ...last, steps: event.steps }
                : event.type === 'error'
                  ? { ...last, problem: event.problem, live: false }
                  : { ...last, sources: event.sources, record: event.record, live: false }
          return [...prev.slice(0, -1), next]
        })
      }),
    [thread],
  )

  // Closing forgets the thread: an answer still running is stopped.
  useEffect(() => () => void api.invoke(IPC.quickAskCancel, thread), [thread])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [turns])

  const ready = status?.state === 'ready' || status?.state === 'loading'
  const selectedHere = useCanvasSelection(isCanvas(note) ? note : null)

  const sendQuestion = useCallback(
    (asked: string): boolean => {
      const question = asked.trim()
      if (question === '' || note === null || model === null || live || !ready) return false
      // Earlier turns as said, each answer with its record; only the new question carries the note's text (main adds it).
      const history = turns
        .filter((t) => t.problem === undefined && t.content !== '')
        .map(({ role, content, record }) => ({ role, content, ...(record === undefined ? {} : { record }) }))
      const at = createdStamp(new Date())
      setTurns((prev) => [
        ...prev,
        { role: 'user', content: question, note, at },
        { role: 'assistant', content: '', note, at, model, live: true },
      ])
      setDraft('')
      setSaveError(null)
      // On a canvas, what is selected there goes with the question (main reads the canvas).
      const selection = isCanvas(note) ? [...canvasSelection(note)] : []
      void api.invoke(IPC.quickAskSend, { thread, note, model, history, question, ...(selection.length === 0 ? {} : { selection }) })
      return true
    },
    [note, model, live, ready, turns, thread],
  )
  const send = useCallback(() => void sendQuestion(draft), [sendQuestion, draft])

  // A question asked from elsewhere (a canvas command): sent as if typed, once the model is ready.
  const requested = useQuickAskRequest()
  useEffect(() => {
    if (requested === null || !ready || model === null || live || note === null) return
    if (sendQuestion(requested.question)) takeQuickAsk()
  }, [requested, ready, model, live, note, sendQuestion])

  const saveAsChat = useCallback(async () => {
    const messages: BotMessage[] = turns
      .filter((t) => t.live !== true && t.problem === undefined && t.content !== '')
      .map((t) => ({
        role: t.role,
        content: t.content,
        at: t.at,
        ...(t.model === undefined ? {} : { model: t.model }),
        ...(t.steps === undefined || t.steps.length === 0 ? {} : { steps: t.steps }),
        ...(t.sources === undefined ? {} : { sources: t.sources.map((path) => ({ path, heading: null })) }),
        ...(t.record === undefined ? {} : { record: t.record }),
      }))
    const saved = await api.invoke(IPC.botsSaveThread, { botId: 'recto', messages })
    if (!saved.ok) {
      setSaveError(saved.error)
      return
    }
    // The thread moves: it is a chat now, and Quick ask starts clean.
    openChats('recto')
    requestTopic('recto', saved.topic)
    onClose()
  }, [turns, onClose])

  const canSave = turns.some((t) => t.role === 'assistant' && t.live !== true && t.problem === undefined && t.content !== '')
  const lastSuggested = turns.at(-1)?.steps?.some((s) => s.action.startsWith('Suggested') && s.state === 'done') === true
  const lastAnswer = turns.findLast((t) => t.role === 'assistant' && t.live !== true && t.content !== '')
  const motion = useBotMotion()
  const { style, above, right } = bubbleAt(place, size, motion.drag)
  const followUp = turns.length > 0

  return (
    <div
      className={`quick-ask${above ? ' is-above' : ' is-below'}${right ? ' is-right' : ' is-left'}${motion.gliding ? ' is-gliding' : ''}`}
      style={{ ...style, visibility: shown ? 'visible' : 'hidden' }}
      role="dialog"
      aria-label="Quick ask"
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && !menu) onClose()
      }}
    >
      {/* Over the question's first line when there is nothing above it, so it takes no row of its own. */}
      <div className={`quick-ask__head${turns.length === 0 ? ' is-floating' : ''}`}>
        <span className="quick-ask__gap" />
        {canSave && (
          <Tip label="Save as chat" hint="Moves this thread into the Chats panel">
            <button className="icon-btn" aria-label="Save as chat" disabled={live} onClick={() => void saveAsChat()}>
              <Icon name="messages-square" size={15} />
            </button>
          </Tip>
        )}
        {lastAnswer !== undefined && (
          <Tip label={copied ? 'Copied' : 'Copy the answer'}>
            <button
              className="icon-btn"
              aria-label="Copy the answer"
              onClick={() =>
                void navigator.clipboard.writeText(lastAnswer.content).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }
            >
              <Icon name={copied ? 'check' : 'copy'} size={15} />
            </button>
          </Tip>
        )}
        <Tip label="Close" hint="Esc · forgets the thread">
          <button className="icon-btn" aria-label="Close Quick ask" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </Tip>
      </div>

      {turns.length > 0 && (
        <div className="quick-ask__log" ref={scroller}>
          {turns.map((turn, i) => {
            const previous = turns.slice(0, i).findLast((t) => t.role === 'user')
            const about = turn.role === 'user' && previous?.note !== turn.note
            return (
              <div key={i} className="quick-ask__turn">
                {about && <p className="quick-ask__about">About: {titleOf(turn.note)}</p>}
                {turn.role === 'user' ? (
                  <p className="quick-ask__q">{turn.content}</p>
                ) : (
                  <div className="quick-ask__a">
                    {turn.steps !== undefined && <StepsCard steps={turn.steps} running={turn.live === true && turn.content === ''} skimmed={turn.record?.skimmed.length ?? 0} />}
                    {turn.content !== '' && (
                      <Markdown
                        text={turn.content}
                        titles={(turn.sources ?? []).map(titleOf)}
                        onOpenNote={(title) =>
                          void api.invoke(IPC.indexResolveLink, title, '').then((resolved) => {
                            if (resolved !== null) openFile(resolved)
                          })
                        }
                      />
                    )}
                    {turn.live === true && turn.content === '' && (turn.steps ?? []).length === 0 && (
                      <p className="quick-ask__thinking">Reading…</p>
                    )}
                    {turn.record !== undefined && turn.record.proposals.length === 0 && claimsPendingEdit(turn.content) && (
                      <p className="quick-ask__no-edit">No edit was created</p>
                    )}
                    {turn.problem !== undefined && <ProblemLine problem={turn.problem} />}
                  </div>
                )}
              </div>
            )
          })}
          {lastSuggested && (
            <button className="quick-ask__review" onClick={openSuggestedEdits}>
              <Icon name="sparkles" size={13} /> Review the suggested edit
            </button>
          )}
          {saveError !== null && <p className="quick-ask__error">{saveError}</p>}
        </div>
      )}

      {status !== null && status.state === 'provider' ? (
        <ProblemLine problem={status.problem} onDismiss={recheck} />
      ) : status !== null && !ready ? (
        <p className="composer__status">
          <span className="composer__dot" aria-hidden="true" />
          The model on this Mac is not ready (Settings → Bots).
        </p>
      ) : null}

      <textarea
        ref={input}
        className="quick-ask__input"
        rows={1}
        placeholder={
          note === null
            ? 'Open a note to ask about it'
            : followUp
              ? 'Anything else you’d like to know?'
              : isCanvas(note)
                ? selectedHere.length > 0
                  ? 'Ask anything about what is selected…'
                  : 'Ask anything about this canvas…'
                : 'Ask anything about this note…'
        }
        disabled={note === null}
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onKeyDown={(ev) => {
          // Typing stays here; ⌘ shortcuts (⌘O to switch note, ⌘J to close) still reach the app.
          if (!ev.metaKey) ev.stopPropagation()
          if (ev.key === 'Escape') onClose()
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault()
            send()
          }
        }}
      />

      <div className="quick-ask__bar">
        {note !== null && (
          <Tip
            label="What goes with each question"
            hint={
              isCanvas(note)
                ? 'What is selected on this canvas - or all of it - and the notes on it'
                : 'This note, and the notes it links to or that link to it'
            }
          >
            <span className="quick-ask__note">
              <Icon name={isCanvas(note) ? 'scan' : 'file-text'} size={13} />
              <span>
                {isCanvas(note) && selectedHere.length > 0 ? `${selectedHere.length} selected on ${titleOf(note)}` : titleOf(note)}
              </span>
            </span>
          </Tip>
        )}
        {model !== null && <ModelChip model={model} open={menu} onToggle={() => setMenu((m) => !m)} />}
        <span className="quick-ask__gap" />
        {live ? (
          <button className="quick-ask__send" aria-label="Stop" onClick={() => void api.invoke(IPC.quickAskCancel, thread)}>
            <Icon name="square" size={12} />
          </button>
        ) : (
          <button className="quick-ask__send" aria-label="Ask" disabled={draft.trim() === '' || note === null || !ready} onClick={send}>
            <Icon name="arrow-up" size={15} />
          </button>
        )}
      </div>
      {menu && model !== null && (
        <ModelMenu
          current={model}
          cloud
          pulling={null}
          onPick={(next) => {
            setMenu(false)
            setModel(next)
            try {
              localStorage.setItem(MODEL_KEY, next)
            } catch {
              // Not remembered this time; the default stays.
            }
          }}
          onDownload={(name) => void api.invoke(IPC.botsPull, name)}
          onClose={() => setMenu(false)}
        />
      )}
      {pointing && <span className="quick-ask__tail" aria-hidden="true" />}
    </div>
  )
}
