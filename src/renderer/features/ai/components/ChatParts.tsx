import type { AiMessage } from '@shared/ai'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { Markdownish } from './Markdownish'

/**
 * The parts of a chat that every chat shares: the turns and the composer.
 * The main chat and the bots' chats are built from these same two, so they
 * read and type alike - neither has a copy of the other's markup.
 */

/** The turns, the reply being written, and the last error. */
export function ChatMessages<M extends AiMessage>({
  messages,
  pending,
  error,
  onDismissError,
  assistant = 'Claude',
  labelOf,
  after,
}: {
  messages: readonly M[]
  /** The reply being streamed: '' before its first token, null between turns. */
  pending: string | null
  error: string | null
  onDismissError: () => void
  /** The name over the assistant's turns. */
  assistant?: string
  /** A turn's own name, when turns of one thread were written by different models (an old main-chat answer is Claude's). */
  labelOf?: (message: M) => string | undefined
  /** Anything to show under a turn (a bot's sources). */
  after?: (message: M, index: number) => React.ReactNode
}): React.ReactElement {
  return (
    <>
      {messages.map((message, index) => (
        <article className={`chat__turn chat__turn--${message.role}`} key={index}>
          <span className="chat__role">{message.role === 'user' ? 'You' : (labelOf?.(message) ?? assistant)}</span>
          <div className="chat__body">
            {message.role === 'user' ? <p className="chat__para">{message.content}</p> : <Markdownish text={message.content} />}
          </div>
          {after?.(message, index)}
        </article>
      ))}

      {pending !== null && (
        <article className="chat__turn chat__turn--assistant">
          <span className="chat__role">{assistant}</span>
          <div className="chat__body">
            {pending === '' ? (
              <span className="chat__thinking" aria-live="polite">
                Thinking
                <i />
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
        <p className="chat__error" role="alert" onClick={onDismissError}>
          {error}
        </p>
      )}
    </>
  )
}

/** The input, welded to the bottom of the column, with whatever tools the chat has and Send / Stop. */
export function ChatComposer({
  draft,
  onDraft,
  pending,
  onSend,
  onStop,
  placeholder,
  tools,
  inputRef,
  onFocus,
  onBlur,
  disabled = false,
}: {
  draft: string
  onDraft: (text: string) => void
  pending: boolean
  onSend: () => void
  onStop: () => void
  placeholder: string
  /** Shown before the hint (the main chat's model picker). */
  tools?: React.ReactNode
  inputRef?: React.Ref<HTMLTextAreaElement>
  onFocus?: () => void
  onBlur?: () => void
  /** Nothing can be sent (the bot's model is not available). */
  disabled?: boolean
}): React.ReactElement {
  return (
    <div className="chat__composer">
      <textarea
        ref={inputRef}
        className="chat__input"
        rows={1}
        value={draft}
        placeholder={placeholder}
        {...(onFocus ? { onFocus } : {})}
        {...(onBlur ? { onBlur } : {})}
        onChange={(event) => {
          onDraft(event.target.value)
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
            if (!disabled) onSend()
          }
          if (event.key === 'Escape' && pending) onStop()
        }}
      />
      <div className="chat__tools">
        {tools}
        <span className="chat__hint">{!pending ? 'Enter to send · Shift+Enter for a new line' : 'Esc to stop'}</span>
        {!pending ? (
          <Tip label="Send" hint="Enter">
            <button className="chat__send" onClick={onSend} disabled={disabled || draft.trim() === ''} aria-label="Send">
              <Icon name="arrow-up" size={15} />
            </button>
          </Tip>
        ) : (
          <Tip label="Stop" hint="Esc">
            <button className="chat__send chat__send--stop" onClick={onStop} aria-label="Stop">
              <Icon name="square" size={13} />
            </button>
          </Tip>
        )}
      </div>
    </div>
  )
}
