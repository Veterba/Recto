import { useEffect, useState } from 'react'
import type { ModelStatus, TopicInfo, TopicsPreview, TopicsSettings, TopicsStatus } from '@shared/topics'
import { api } from '../api'
import { Icon } from '../components/Icon'

/**
 * Settings → Topics.
 *
 * The machine groups notes into topics; this screen says whether it is on,
 * whether it is ready, what topics there are, and how to undo its last run.
 * Everything else is under Advanced.
 */

/** Under this many eligible notes, few clusters are big and clear enough to be topics. */
const WORKS_BEST_FROM = 50

const MB = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`
const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
const when = (at: number): string => {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function modelLine(model: ModelStatus): string {
  switch (model.state) {
    case 'missing':
      return `Model not downloaded — ${MB(model.bytes)}, once`
    case 'downloading':
      return `Downloading model ${Math.floor((model.received / model.bytes) * 100)}%`
    case 'waiting-network':
      return 'Model download waiting for a connection'
    case 'ready':
      return 'Model ready'
    case 'error':
      return model.message
  }
}

function statusLine(status: TopicsStatus): string {
  const read = `${status.embedded} of ${status.eligible} notes read`
  const waiting =
    status.backfill === 'waiting-power' ? ' — rest on the charger' : status.backfill === 'waiting-idle' ? ' — rest when idle' : ''
  return status.model.state === 'ready' ? `${modelLine(status.model)} · ${read}${waiting}` : modelLine(status.model)
}

/** Text committed on Enter or blur. */
function CommitField({
  value,
  onCommit,
  label,
  placeholder,
}: {
  value: string
  onCommit: (next: string) => void
  label: string
  placeholder?: string
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className="dialog__input setting__path"
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function TopicRow({ topic, onChanged }: { topic: TopicInfo; onChanged: () => void }): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="topics__row" role="listitem">
      {editing ? (
        <input
          className="dialog__input topics__rename"
          defaultValue={topic.name}
          autoFocus
          aria-label={`Rename ${topic.name}`}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') setEditing(false)
            if (event.key !== 'Enter') return
            const next = event.currentTarget.value
            void api.invoke('topics:rename', topic.id, next).then((result) => {
              if (!result.ok) return setError(result.error ?? 'Could not rename.')
              setError(null)
              setEditing(false)
              onChanged()
            })
          }}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <span className="topics__name">{topic.name}</span>
      )}
      <span className="topics__count">{topic.notes}</span>
      <button className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
        Rename
      </button>
      <button
        className="btn btn--ghost btn--sm"
        onClick={() => void api.invoke('topics:delete', topic.id).then(onChanged)}
      >
        Delete
      </button>
      {error !== null && <span className="topics__error">{error}</span>}
    </div>
  )
}

export function TopicsSettingsTab(): React.ReactElement {
  const [settings, setSettings] = useState<TopicsSettings | null>(null)
  const [status, setStatus] = useState<TopicsStatus | null>(null)
  const [topics, setTopics] = useState<TopicInfo[]>([])
  /** The first run was waiting when this screen opened: the line stays while it is open. */
  const [firstLook, setFirstLook] = useState<number | null>(null)
  const [preview, setPreview] = useState<TopicsPreview | 'loading' | null>(null)
  const [advanced, setAdvanced] = useState(false)

  const refresh = (): void => void api.invoke('topics:list').then(setTopics)

  useEffect(() => {
    void api.invoke('topics:settings').then(setSettings)
    void api.invoke('topics:status').then((next) => {
      setStatus(next)
      // Seen: nothing is written until the next scheduled run after this.
      if (next.review.pending) {
        setFirstLook(next.review.notes)
        void api.invoke('topics:seen')
      }
    })
    refresh()
    return api.on('topics:status', (next) => {
      setStatus(next)
      refresh()
    })
  }, [])

  if (settings === null || status === null) return <p className="setting__hint">Reading…</p>

  const update = (patch: Partial<TopicsSettings>): void => {
    void api.invoke('topics:set-settings', patch).then(setSettings)
  }

  return (
    <>
      {firstLook !== null && settings.enabled && (
        <div className="autolinks__first">
          <p className="setting__note">
            <Icon name="tags" size={13} />
            {firstLook > 0 ? `The next run will group ${firstLook} notes into topics.` : 'Topics are made once every note has been read.'}{' '}
            {status.review.devGuarded ? 'Dev build: nothing is written.' : 'Nothing is written yet.'}
            <button
              className="btn btn--ghost btn--sm autolinks__preview-btn"
              disabled={preview === 'loading'}
              onClick={() => {
                setPreview('loading')
                void api.invoke('topics:preview').then(setPreview)
              }}
            >
              {preview === 'loading' ? 'Working it out…' : 'Preview'}
            </button>
          </p>
          {preview !== null && preview !== 'loading' && (
            <div className="autolinks__preview" role="list" aria-label="Topics the next run would write">
              <p className="setting__hint">
                {preview.topics.length} topics, {preview.assignments.length} of {preview.notes} notes.
              </p>
              {preview.topics.map((t) => (
                <div className="autolinks__preview-row" role="listitem" key={t.name}>
                  <span className="autolinks__preview-names">
                    {t.name} <span className="autolinks__arrow">·</span> {t.sample.map(name).join(', ')}
                  </span>
                  <span className="autolinks__preview-score">{t.size}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Row
        label={
          <>
            Topics <span className="topics__badge">Experimental</span>
          </>
        }
        hint="Groups similar notes under a topic in their topics property."
      >
        <button
          className={`toggle${settings.enabled ? ' is-on' : ''}`}
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Topics"
          onClick={() => update({ enabled: !settings.enabled })}
        >
          <span className="toggle__knob" />
        </button>
      </Row>
      {status.eligible < WORKS_BEST_FROM && (
        <div className="setting">
          <span className="setting__hint">
            Works best from about {WORKS_BEST_FROM} notes. You have {status.eligible}.
          </span>
        </div>
      )}

      <Row label="Status" hint={statusLine(status)}>
        {(status.model.state === 'missing' || status.model.state === 'error') && (
          <button className="btn btn--sm" onClick={() => void api.invoke('topics:download')}>
            Download
          </button>
        )}
      </Row>
      {status.model.state === 'downloading' && (
        <div className="autolinks__bar" aria-hidden>
          <span style={{ width: `${(status.model.received / status.model.bytes) * 100}%` }} />
        </div>
      )}

      {topics.length > 0 && (
        <div className="topics__list" role="list" aria-label="Topics">
          {topics.map((t) => (
            <TopicRow key={t.id} topic={t} onChanged={refresh} />
          ))}
        </div>
      )}

      <Row label="Undo last run" hint={status.lastRun === null ? 'Nothing to undo.' : `Last run: ${status.lastRun.notes} notes, ${when(status.lastRun.at)}`}>
        <button
          className="btn btn--ghost btn--sm"
          disabled={status.lastRun === null}
          onClick={() => void api.invoke('topics:undo-last-run').then(refresh)}
        >
          Undo
        </button>
      </Row>

      <button className="topics__advanced" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        <span className={`backlinks__chevron${advanced ? ' is-open' : ''}`}>{'›'}</span>
        Advanced
      </button>
      {advanced && (
        <>
          <Row label="Quiet period" hint={`A note is looked at ${settings.quietMinutes} min after its last edit.`}>
            <input
              className="slider"
              type="range"
              min={15}
              max={240}
              step={15}
              value={settings.quietMinutes}
              onChange={(event) => update({ quietMinutes: Number(event.target.value) })}
            />
          </Row>
          <Row label="Minimum words" hint={`Notes under ${settings.minWords} words of their own get no topic.`}>
            <input
              className="slider"
              type="range"
              min={30}
              max={300}
              step={10}
              value={settings.minWords}
              onChange={(event) => update({ minWords: Number(event.target.value) })}
            />
          </Row>
          <Row label="Excluded folders" hint="Comma separated. Daily notes and templates are always out.">
            <CommitField
              value={settings.excluded.join(', ')}
              label="Excluded folders"
              placeholder="Archive, Inbox"
              onCommit={(raw) =>
                update({
                  excluded: raw
                    .split(',')
                    .map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
                    .filter((f) => f !== ''),
                })
              }
            />
          </Row>
          <Row label="Rebuild topics" hint="Groups every note again; topics that continue keep their names.">
            <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke('topics:rebuild').then(refresh)}>
              Rebuild
            </button>
          </Row>
        </>
      )}
    </>
  )
}

function Row({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint !== undefined && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}
