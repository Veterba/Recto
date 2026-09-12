import { useCallback, useEffect, useState } from 'react'
import type { BacklinkResult } from '@shared/ipc-contract'
import { api } from '../api'
import { Icon } from './Icon'

/**
 * Notes that link to the one you are reading.
 *
 * Lives under the editor rather than in a side panel: it belongs to the note,
 * and a note with no backlinks should cost almost no screen space. Collapsed
 * state is per-viewer and per-session, which is the one thing `localStorage`
 * is genuinely right for.
 */

const COLLAPSE_KEY = 'backlinks-collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    // Private windows and blocked site data both throw here.
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  } catch {
    // A remembered preference is not worth failing over.
  }
}

type Props = {
  path: string
  /** Bumped by the parent when the note is saved, to refresh the list. */
  revision: number
  onOpen: (path: string) => void
}

export function Backlinks({ path, revision, onOpen }: Props): React.ReactElement | null {
  const [links, setLinks] = useState<BacklinkResult[] | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const load = useCallback(() => {
    void api.invoke('index:backlinks', path).then(setLinks)
  }, [path])

  useEffect(load, [load, revision])

  if (links === null) return null

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    writeCollapsed(next)
  }

  return (
    <section className={`backlinks${collapsed ? ' is-collapsed' : ''}`}>
      <button className="backlinks__head" onClick={toggle} aria-expanded={!collapsed}>
        <span className={`backlinks__chevron${collapsed ? '' : ' is-open'}`}>{'›'}</span>
        <span className="backlinks__title">Linked mentions</span>
        <span className="backlinks__count">{links.length}</span>
      </button>

      {!collapsed && (
        <div className="backlinks__body">
          {links.length === 0 ? (
            <p className="backlinks__empty">Nothing links here yet.</p>
          ) : (
            <ul className="backlinks__list">
              {links.map((link, i) => (
                <li key={`${link.path}:${link.line}:${i}`}>
                  <button className="backlink" onClick={() => onOpen(link.path)}>
                    <span className="backlink__name">
                      {link.title ?? link.path.slice(link.path.lastIndexOf('/') + 1).replace(/\.md$/, '')}
                    </span>
                    {link.context !== null && link.context !== '' && (
                      <span className="backlink__context">{link.context}</span>
                    )}
                    <Icon name="arrow-right" size={13} className="backlink__go" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
