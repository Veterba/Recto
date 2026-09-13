import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AI_MODELS, type AiMessage, type AiModelId } from '@shared/ipc-contract'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { Tip } from '../components/Tip'
import { registerView } from '../core/view-registry'
import { noteIndexChanged } from '../core/note-bus'
import { Markdownish } from './Markdownish'
import { parseConversation, serialiseConversation, titleFrom } from './conversation'

/**
 * The chat.
 *
 * Every turn is written back into the note the moment it completes, so the
 * conversation on screen and the markdown file on disk are never out of step -
 * close the window mid-answer and what arrived is still there. That is the
 * whole benefit of conversations being notes, and it only holds if the save is
 * not deferred to some "session end" that may never happen.
 */

type State = { path?: unknown }

const SYSTEM = [
  'You are a writing and thinking assistant inside Recto, a local-first markdown notes app.',
  'The user keeps plain markdown files in a folder they own.',
  'Answer in markdown. Be concise and concrete; prefer a direct answer to a preamble.',
].join(' ')

function useKeyPresent(): boolean | null {
  const [present, setPresent] = useState<boolean | null>(null)
  useEffect(() => {
    void api.invoke('ai:key-status').then((status) => setPresent(status.present))
  }, [])
  return present
}

function Chat({
  path,
  model,
  onModel,
  onTitle,
}: {
  path: string
  model: AiModelId
  onModel: (m: AiModelId) => void
  /** Publishes the title into leaf state, which is what the tab shows. */
  onTitle: (title: string) => void
}): React.ReactElement {
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [title, setTitle] = useState('New chat')
  const [draft, setDraft] = useState('')
  /** The reply being streamed, or null between turns. */
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const keyPresent = useKeyPresent()

  const scroller = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  /** The id of the running stream: the note path, which is unique per chat. */
  const streamId = path

  // --- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void api.invoke('fs:read', path).then((result) => {
      if (cancelled || !result.ok) return
      const parsed = parseConversation(result.content)
      setMessages(parsed.messages)
      const loadedTitle = parsed.title === '' ? 'New chat' : parsed.title
      setTitle(loadedTitle)
      onTitle(loadedTitle)
      if (parsed.model !== null && AI_MODELS.some((m) => m.id === parsed.model)) {
        onModel(parsed.model as AiModelId)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // `onModel` is a setter from above and changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const save = useCallback(
    async (next: readonly AiMessage[], nextTitle: string) => {
      await api.invoke(
        'fs:write',
        path,
        serialiseConversation({ title: nextTitle, model, messages: [...next] }),
      )
      noteIndexChanged()
    },
    [path, model],
  )

  // --- streaming ----------------------------------------------------------
  useEffect(() => {
    const offDelta = api.on('ai:delta', (delta) => {
      if (delta.id !== streamId) return
      setPending((current) => (current ?? '') + delta.text)
    })
    const offDone = api.on('ai:done', (done) => {
      if (done.id !== streamId) return
      setPending((current) => {
        const text = (current ?? '').trim()
        if (text !== '') {
          setMessages((prev) => {
            const next = [...prev, { role: 'assistant' as const, content: text }]
            void save(next, titleFrom(next))
            return next
          })
        }
        return null
      })
    })
    const offError = api.on('ai:error', (failure) => {
      if (failure.id !== streamId) return
      // A cancelled stream still has whatever arrived before the stop, and
      // throwing that away would be the rudest possible response to "stop".
      setPending((current) => {
        const text = (current ?? '').trim()
        if (text !== '') {
          setMessages((prev) => {
            const next = [...prev, { role: 'assistant' as const, content: text }]
            void save(next, titleFrom(next))
            return next
          })
        }
        return null
      })
      setError(failure.message)
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [streamId, save])

  // Keep the newest text in view while it streams, but never yank the view
  // away from someone who has scrolled up to read something.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [messages, pending])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || pending !== null) return
    setError(null)
    const next: AiMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setDraft('')
    const nextTitle = titleFrom(next)
    setTitle(nextTitle)
    onTitle(nextTitle)
    await save(next, nextTitle)

    setPending('')
    const started = await api.invoke('ai:send', { id: streamId, model, system: SYSTEM, messages: next })
    if (!started.ok) {
      setPending(null)
      setError(started.error ?? 'Could not start.')
    }
    // `onTitle` writes to leaf state and is stable enough to leave out; adding
    // it would re-create `send` on every keystroke in another tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, messages, pending, model, save, streamId])

  const stop = useCallback(() => {
    void api.invoke('ai:cancel', streamId)
  }, [streamId])

  const empty = messages.length === 0 && pending === null

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scroller}>
        <div className="chat__thread">
          {loaded && empty && (
            <div className="chat__welcome">
              <h2>{keyPresent === false ? 'Add your API key' : 'Ask anything'}</h2>
              <p>
                {keyPresent === false ? (
                  <>
                    Settings → AI. The key is encrypted into your login keychain and never leaves this
                    machine — the renderer that draws this window cannot read it.
                  </>
                ) : (
                  <>
                    This conversation is a note in <code>chats/</code>. It is searchable, linkable and
                    yours — the same markdown as everything else in the vault.
                  </>
                )}
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <article className={`chat__turn chat__turn--${message.role}`} key={index}>
              <span className="chat__role">{message.role === 'user' ? 'You' : 'Claude'}</span>
              <div className="chat__body">
                {message.role === 'user' ? (
                  <p className="chat__para">{message.content}</p>
                ) : (
                  <Markdownish text={message.content} />
                )}
              </div>
            </article>
          ))}

          {pending !== null && (
            <article className="chat__turn chat__turn--assistant">
              <span className="chat__role">Claude</span>
              <div className="chat__body">
                {pending === '' ? (
                  <span className="chat__thinking" aria-live="polite">
                    Thinking<i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <Markdownish text={pending} />
                )}
              </div>
            </article>
          )}

          {error !== null && (
            <p className="chat__error" role="alert" onClick={() => setError(null)}>
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="chat__composer">
        <textarea
          ref={composer}
          className="chat__input"
          rows={1}
          value={draft}
          placeholder={`Message ${AI_MODELS.find((m) => m.id === model)?.label ?? 'Claude'}…`}
          onChange={(event) => {
            setDraft(event.target.value)
            // Grow with the text, to a point. Past that it scrolls, or the
            // composer eats the conversation it belongs to.
            const element = event.target
            element.style.height = 'auto'
            element.style.height = `${Math.min(220, element.scrollHeight)}px`
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
            if (event.key === 'Escape' && pending !== null) stop()
          }}
        />
        <div className="chat__tools">
          <select
            className="chat__model"
            value={model}
            aria-label="Model"
            onChange={(event) => onModel(event.target.value as AiModelId)}
          >
            {AI_MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="chat__hint">{pending === null ? 'Enter to send · Shift+Enter for a new line' : 'Esc to stop'}</span>
          {pending === null ? (
            <Tip label="Send" hint="Enter">
              <button className="chat__send" onClick={() => void send()} disabled={draft.trim() === ''} aria-label="Send">
                <Icon name="arrow-up" size={15} />
              </button>
            </Tip>
          ) : (
            <Tip label="Stop" hint="Esc">
              <button className="chat__send chat__send--stop" onClick={stop} aria-label="Stop">
                <Icon name="square" size={13} />
              </button>
            </Tip>
          )}
        </div>
      </div>
      <span className="chat__title" hidden>
        {title}
      </span>
    </div>
  )
}

/**
 * Registered with a getter for the model, because the model is an app-level
 * setting and the view must not own a copy that drifts from it.
 */
export function registerChatView(
  getModel: () => AiModelId,
  setModel: (model: AiModelId) => void,
): () => void {
  return registerView({
    type: 'chat',
    title: 'Chat',
    icon: 'sparkles',
    // The tab is named after the conversation, not after the feature. The title
    // is kept in leaf state rather than looked up, so a restored layout shows
    // the right names before a single file has been read.
    getTitle: (state) => {
      const title = (state as { title?: unknown }).title
      return typeof title === 'string' && title !== '' ? title : 'Chat'
    },
    render: ({ state, setState }) => {
      const path = (state as State).path
      if (typeof path !== 'string' || path === '') {
        return (
          <div className="pane-empty">
            <p>Pick a conversation, or start one with the New chat button.</p>
          </div>
        )
      }
      return (
        <Chat
          path={path}
          model={getModel()}
          onModel={setModel}
          onTitle={(title) => {
            if (state['title'] !== title) setState({ ...state, title })
          }}
        />
      )
    },
  })
}
