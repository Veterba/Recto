import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { registerView } from '../core/view-registry'

/**
 * Every link in the vault that points at nothing.
 *
 * Useful two ways: as a list of notes you meant to write, and as a way to spot
 * a typo in a link you thought worked. Creating the note from here is the
 * obvious next action, so it is one click.
 */

type Entry = { target: string; sources: string[] }

function Unresolved({ onOpen }: { onOpen: (path: string) => void }): React.ReactElement {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.invoke('index:unresolved').then(setEntries)
  }, [])

  useEffect(load, [load])

  const create = async (target: string): Promise<void> => {
    setBusy(target)
    // Written at the vault root with the link's own text as the filename, which
    // is what makes the link resolve on the next index pass.
    const result = await api.invoke('fs:create', '', `${target}.md`, 'file')
    if (result.ok) {
      await api.invoke('fs:write', result.path, `# ${target}\n\n`)
      onOpen(result.path)
    }
    setBusy(null)
    load()
  }

  if (!entries) return <div className="pane-empty" />

  return (
    <div className="archive">
      <header className="archive__head">
        <h2 className="archive__title">Unresolved links</h2>
        <p className="archive__lede">
          Links pointing at notes that do not exist. Either a note you meant to write, or a typo in
          a link you thought worked.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="archive__empty">Every link in the vault resolves.</p>
      ) : (
        <ul className="archive__list">
          {entries.map((entry) => (
            <li key={entry.target} className={`unresolved__item${busy === entry.target ? ' is-busy' : ''}`}>
              <span className="unresolved__target">[[{entry.target}]]</span>
              <span className="unresolved__sources">
                {entry.sources.length === 1 ? 'from ' : `from ${entry.sources.length} notes: `}
                {entry.sources.slice(0, 4).map((source, i) => (
                  <span key={source}>
                    {i > 0 && ', '}
                    <button className="unresolved__link" onClick={() => onOpen(source)}>
                      {source.slice(source.lastIndexOf('/') + 1).replace(/\.md$/, '')}
                    </button>
                  </span>
                ))}
                {entry.sources.length > 4 && ` +${entry.sources.length - 4}`}
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => void create(entry.target)}>
                Create note
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function registerUnresolvedView(onOpen: (path: string) => void): () => void {
  return registerView({
    type: 'unresolved',
    title: 'Unresolved links',
    render: () => <Unresolved onOpen={onOpen} />,
  })
}
