import { useEffect, useState } from 'react'
import type { AutolinkSuggestions } from '@shared/autolinks'
import { api } from '../api'
import { Icon } from './Icon'
import { Tip } from './Tip'

/**
 * "Suggested links", under the properties: up to three notes this one seems
 * to be about, found by the local model. Nothing is written until a chip is
 * clicked; × says no, and that pair is never suggested again.
 *
 * Renders nothing when there is nothing to suggest - an empty row with a
 * heading would be one more thing between the title and the text.
 */
export function SuggestedLinks({
  path,
  onAccept,
}: {
  path: string
  /** Write `[[link]]` into the note's `property`. Resolves once it is saved. */
  onAccept: (property: string, link: string) => Promise<void>
}): React.ReactElement | null {
  const [data, setData] = useState<AutolinkSuggestions | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void api.invoke('autolinks:suggestions', path).then((next) => {
        if (!cancelled) setData(next)
      })
    }
    load()
    const off = api.on('autolinks:changed', (paths) => {
      if (paths.includes(path)) load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [path])

  if (data === null || data.items.length === 0) return null

  const drop = (target: string): void =>
    setData((current) => current && { ...current, items: current.items.filter((x) => x.target !== target) })

  return (
    <div className="suggested" role="group" aria-label="Suggested links">
      <span className="suggested__label">
        <Icon name="sparkles" size={12} />
        Suggested links
      </span>
      <div className="suggested__chips">
        {data.items.map((item) => (
          <span className="suggested__chip" key={item.target}>
            <Tip label={`Add to ${data.property}`} hint={item.reason === '' ? undefined : `“${item.reason}”`} wrap>
              <button
                className="suggested__add"
                onClick={() => {
                  drop(item.target)
                  void onAccept(data.property, item.link).then(() =>
                    api.invoke('autolinks:accept', path, item.target),
                  )
                }}
              >
                <Icon name="plus" size={11} />
                {item.name}
              </button>
            </Tip>
            <Tip label="Not related" hint="Never suggest this pair again">
              <button
                className="suggested__reject"
                aria-label={`Reject ${item.name}`}
                onClick={() => {
                  drop(item.target)
                  void api.invoke('autolinks:reject', path, item.target)
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </Tip>
          </span>
        ))}
      </div>
    </div>
  )
}
