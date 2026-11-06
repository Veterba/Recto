import { useCallback, useEffect, useState } from 'react'
import type { BacklinkResult } from '@shared/index-results'
import { api } from '../../../app/api'
import { Icon } from '../../../ui/Icon'
import { plainSnippet } from '../../search'
import { IPC } from '@shared/ipc'

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

/** What a linking note is called in the list: its title, or its file name. */
const nameOf = (link: { path: string; title: string | null }): string => link.title ?? link.path.slice(link.path.lastIndexOf('/') + 1).replace(/\.md$/, '')
const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

export function Backlinks({ path, revision, onOpen }: Props): React.ReactElement | null {
  const [links, setLinks] = useState<BacklinkResult[] | null>(null)
  /** The canvases this note is on: each an "On canvas …" entry. */
  const [canvases, setCanvases] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const load = useCallback(() => {
    void api.invoke(IPC.indexBacklinks, path).then(setLinks)
    void api.invoke(IPC.indexCanvasesOf, path).then(setCanvases)
  }, [path])

  useEffect(load, [load, revision])

  if (links === null) return null

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    writeCollapsed(next)
  }

  const names = new Map<string, Set<string>>()
  for (const link of links) names.set(nameOf(link).toLowerCase(), (names.get(nameOf(link).toLowerCase()) ?? new Set()).add(link.path))
  const repeated = new Set([...names].filter(([, paths]) => paths.size > 1).map(([name]) => name))

  return (
    <section className={`backlinks${collapsed ? ' is-collapsed' : ''}`}>
      <button className="backlinks__head" onClick={toggle} aria-expanded={!collapsed}>
        <span className={`backlinks__chevron${collapsed ? '' : ' is-open'}`}>{'›'}</span>
        <span className="backlinks__title">Linked mentions</span>
        <span className="backlinks__count">{links.length + canvases.length}</span>
      </button>

      {!collapsed && (
        <div className="backlinks__body">
          {links.length === 0 && canvases.length === 0 ? (
            <p className="backlinks__empty">Nothing links here yet.</p>
          ) : (
            <ul className="backlinks__list">
              {canvases.map((canvas) => (
                <li key={`canvas:${canvas}`}>
                  <button className="backlink" onClick={() => onOpen(canvas)}>
                    <span className="backlink__name">
                      <Icon name="scan" size={12} /> On canvas {canvas.slice(canvas.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')}
                    </span>
                    <Icon name="arrow-right" size={13} className="backlink__go" />
                  </button>
                </li>
              ))}
              {links.map((link, i) => (
                <li key={`${link.path}:${link.line}:${i}`}>
                  <button className="backlink" onClick={() => onOpen(link.path)}>
                    <span className="backlink__name">
                      {nameOf(link)}
                      {/* Two notes of one name, in different folders: each says which. */}
                      {repeated.has(nameOf(link).toLowerCase()) && <span className="backlink__folder">{folderOf(link.path) || 'top of the vault'}</span>}
                    </span>
                    {link.context !== null && link.context !== '' && (
                      <span className="backlink__context">{plainSnippet(link.context)}</span>
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
