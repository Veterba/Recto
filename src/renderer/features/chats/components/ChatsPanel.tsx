import { useCallback } from 'react'
import { CHATS_MAX_WIDTH, CHATS_MIN_WIDTH } from '../../../app/appearance'
import { commands } from '../../../app/commands'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import type { MenuItem } from '../../../ui/ContextMenu'
import { BotHost, MAIN_BOT, useBots, useBotsEnabled } from '../../bots'
import type { NoteCandidate } from '../../bots/components/Composer'
import { openChats, useShownChat } from '../chats-store'

/**
 * The Chats panel, on the right of the window like Obsidian's right sidebar:
 * a section switcher at the top - AI now, People (chats with whoever shares
 * the vault) later - then, for AI, the bots as a short list and the chat of
 * the one picked under it. The panel takes the place of the docked graph
 * while it is open (VaultShell), so the editor keeps its width.
 */

type Section = { id: 'ai' | 'people'; label: string; ready: boolean }

/** People is a placeholder: there to show where it goes. */
const SECTIONS: readonly Section[] = [
  { id: 'ai', label: 'AI', ready: true },
  { id: 'people', label: 'People', ready: false },
]

type Props = {
  width: number
  onResize: (width: number) => void
  openFile: (path: string, heading?: string | null) => void
  notes: () => readonly NoteCandidate[]
  onOpenSettings: () => void
  floatingBot: boolean
  onToggleFloatingBot: () => void
  onClose: () => void
}


export function ChatsPanel(props: Props): React.ReactElement {
  const shown = useShownChat()
  const botsOn = useBotsEnabled()
  const bots = useBots()

  const startDrag = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const startX = ev.clientX
      const startWidth = props.width
      const onMove = (move: PointerEvent): void => {
        // Dragged left, wider: the handle is on the panel's left edge.
        const room = Math.max(CHATS_MIN_WIDTH, Math.round(window.innerWidth * 0.5))
        props.onResize(Math.min(CHATS_MAX_WIDTH, room, Math.max(CHATS_MIN_WIDTH, startWidth - (move.clientX - startX))))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.classList.remove('is-resizing')
      }
      document.body.classList.add('is-resizing')
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [props],
  )

  // The other bots, one menu away instead of a list over the chat: it is Recto's chat nearly always.
  const others = (bots ?? []).filter((bot) => bot.id !== shown)
  const menuExtra: MenuItem[] = [
    ...others.map(
      (bot): MenuItem => ({ kind: 'item', label: bot.id === MAIN_BOT ? `Back to ${bot.name}` : `Chat with ${bot.name}`, icon: 'bot', run: () => openChats(bot.id) }),
    ),
    ...(others.length > 0 ? [{ kind: 'separator' as const }] : []),
    {
      kind: 'item',
      label: props.floatingBot ? 'Hide the floating bot' : 'Show the floating bot',
      icon: 'bot',
      ...(commands.label('bot:toggle-floating') === null ? {} : { shortcut: commands.label('bot:toggle-floating')! }),
      run: props.onToggleFloatingBot,
    },
  ]

  return (
    <aside className="chats" style={{ width: Math.max(CHATS_MIN_WIDTH, props.width) }} aria-label="Chats">
      <div className="chats__resize" role="separator" aria-orientation="vertical" aria-label="Resize chats" onPointerDown={startDrag} />
      <header className="chats__head">
        <div className="chats__sections" role="tablist" aria-label="Chats">
          {SECTIONS.map((section) => (
            <Tip key={section.id} label={section.ready ? section.label : `${section.label} · coming later`}>
              <button
                role="tab"
                aria-selected={section.id === 'ai'}
                disabled={!section.ready}
                className={`chats__section${section.id === 'ai' ? ' is-active' : ''}`}
              >
                {section.label}
              </button>
            </Tip>
          ))}
        </div>
        <span className="chats__gap" />
        <Tip label="Close chats" hint={commands.label('chats:toggle') ?? undefined}>
          <button className="icon-btn" aria-label="Close chats" onClick={props.onClose}>
            <Icon name="panel-right-close" size={15} />
          </button>
        </Tip>
      </header>

      {botsOn === false ? (
        <p className="bots-off chats__off">
          Bots are off ·{' '}
          <button className="bots-off__link" onClick={props.onOpenSettings}>
            Turn on in Settings
          </button>
        </p>
      ) : (
        <>
          <div className="chats__chat">
            <BotHost key={shown} botId={shown} openFile={props.openFile} notes={props.notes} menuExtra={menuExtra} />
          </div>
        </>
      )}
    </aside>
  )
}
