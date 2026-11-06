import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IPC, IPC_EVENT } from '@shared/ipc'
import { api } from '../api'

/**
 * Obsidian's "Update links", asked when a note is renamed or moved and the
 * vault's "Automatically update internal links" is off (Obsidian's default):
 * the same question and the same three answers, in Obsidian's words. Main
 * waits for the answer before it touches any link (main/ipc.ts `relocate`).
 * Escape, or a click outside, is "Do not update", as closing Obsidian's is.
 */
type Ask = { id: string; links: number; files: number }

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

export function UpdateLinksDialog(): React.ReactElement | null {
  const [asks, setAsks] = useState<Ask[]>([])
  const once = useRef<HTMLButtonElement | null>(null)
  useEffect(() => api.on(IPC_EVENT.linksAsk, (ask) => setAsks((prev) => [...prev, ask])), [])
  const ask = asks[0]
  useEffect(() => once.current?.focus(), [ask?.id])
  if (ask === undefined) return null

  const answer = (choice: 'always' | 'once' | 'never'): void => {
    void api.invoke(IPC.linksAnswer, ask.id, choice)
    setAsks((prev) => prev.slice(1))
  }
  return createPortal(
    <div
      className="dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) answer('never')
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Update links"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') answer('never')
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">Update links</h2>
        </header>
        <p className="dialog__lede">
          Do you want to update internal links that link to this file? This will affect {plural(ask.links, 'link')} in {plural(ask.files, 'file')}.
        </p>
        <footer className="dialog__actions">
          <button className="dialog__ghost" onClick={() => answer('never')}>
            Do not update
          </button>
          <button className="dialog__ghost" onClick={() => answer('always')}>
            Always update
          </button>
          <button ref={once} className="dialog__submit" onClick={() => answer('once')}>
            Just once
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
