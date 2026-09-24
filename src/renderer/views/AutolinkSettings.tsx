import { useEffect, useState } from 'react'
import type { AutolinkSettings, AutolinkStatus, ModelStatus, PreviewLink } from '@shared/autolinks'
import { api } from '../api'
import { Icon } from '../components/Icon'

/**
 * Settings → Auto-links.
 *
 * Everything the feature does is visible here: whether the model is on disk,
 * how far the vectors are, the two thresholds measured on this vault and what
 * the user's corrections have done to them. Nothing is hidden behind "it just works" - a feature that writes to
 * notes owes the user a way to see why.
 */

const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** Which bonuses moved a link up the order. None of them can pass it through the gate. */
function bonuses(l: PreviewLink): string {
  const parts = [
    l.title > 0 ? `name mentioned +${l.title.toFixed(2)}` : '',
    l.tags > 0 ? `shared tags +${l.tags.toFixed(2)}` : '',
    l.cocite > 0 ? `both link a third note +${l.cocite.toFixed(2)}` : '',
    l.hub < 0 ? `much linked-to ${l.hub.toFixed(2)}` : '',
  ].filter((p) => p !== '')
  return `similarity ${l.sem.toFixed(3)}, score ${l.total.toFixed(3)}${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}`
}

const MB = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`

function modelLine(model: ModelStatus): string {
  switch (model.state) {
    case 'missing':
      return `Not downloaded — ${MB(model.bytes)}, once, from Hugging Face. Nothing else ever leaves this Mac.`
    case 'downloading':
      return `Downloading ${Math.floor((model.received / model.bytes) * 100)}% — ${MB(model.received)} of ${MB(model.bytes)}`
    case 'waiting-network':
      return `Waiting for a connection — ${MB(model.received)} of ${MB(model.bytes)} so far; it resumes where it stopped.`
    case 'ready':
      return `Ready — EmbeddingGemma 300M, ${MB(model.bytes)}, runs on this Mac.`
    case 'error':
      return model.message
  }
}

function backfillLine(status: AutolinkStatus): string {
  const counts = `${status.embedded} of ${status.eligible} notes read`
  switch (status.backfill) {
    case 'done':
      return `${counts}.`
    case 'running':
      return `${counts} — reading…`
    case 'waiting-power':
      return `${counts} — the rest waits for the charger.`
    case 'waiting-idle':
      return `${counts} — the rest continues when you step away for a moment.`
    case 'idle':
      return status.model.state === 'ready' ? counts : 'Starts once the model is downloaded.'
  }
}

/** Text committed on Enter or blur, like the folder fields. */
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

export function AutolinkSettingsTab(): React.ReactElement {
  const [settings, setSettings] = useState<AutolinkSettings | null>(null)
  const [status, setStatus] = useState<AutolinkStatus | null>(null)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  /** Auto's first run was waiting when this screen opened: the line stays for as long as it is open. */
  const [firstLook, setFirstLook] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ notes: number; links: PreviewLink[] } | 'loading' | null>(null)

  useEffect(() => {
    void api.invoke('autolinks:settings').then(setSettings)
    void api.invoke('autolinks:status').then((next) => {
      setStatus(next)
      // Seen: nothing is written until the next scheduled run after this.
      if (next.review.pending) {
        setFirstLook(next.review.notes)
        void api.invoke('autolinks:seen')
      }
    })
    return api.on('autolinks:status', (next) => {
      setStatus(next)
      // Measuring thresholds and the first backfill change the settings file too.
      void api.invoke('autolinks:settings').then(setSettings)
    })
  }, [])

  if (settings === null || status === null) return <p className="setting__hint">Reading…</p>

  const update = (patch: Partial<AutolinkSettings>): void => {
    void api.invoke('autolinks:set-settings', patch).then(setSettings)
  }
  const { feedback } = status
  const diagnostic = settings.diagnostic
  const diagnosticRow = diagnostic?.rows.find((r) => r.threshold === diagnostic.chosen)
  const pct = (x: number): string => `${Math.round(x * 100)}%`

  return (
    <>
      {firstLook !== null && settings.mode === 'auto' && (
        <div className="autolinks__first">
          <p className="setting__note">
            <Icon name="link" size={13} />
            {firstLook > 0
              ? `Auto-links will review ${firstLook} ${firstLook === 1 ? 'note' : 'notes'} on its next run and add up to 2 links to each, in the `
              : 'Auto-links will review your notes once every one has been read, and add up to 2 links to each, in the '}
            <code>{settings.property}</code> property. Nothing has been written yet.
            <button
              className="btn btn--ghost btn--sm autolinks__preview-btn"
              disabled={preview === 'loading'}
              onClick={() => {
                setPreview('loading')
                void api.invoke('autolinks:preview').then(setPreview)
              }}
            >
              {preview === 'loading' ? 'Working it out…' : 'Preview'}
            </button>
          </p>
          {preview !== null && preview !== 'loading' && (
            <div className="autolinks__preview" role="list" aria-label="Links Auto would write">
              <p className="setting__hint">
                {preview.links.length} {preview.links.length === 1 ? 'link' : 'links'} in {new Set(preview.links.map((l) => l.source)).size} of{' '}
                {preview.notes} notes. Switch to Suggest to review them one by one instead.
              </p>
              {preview.links.map((l) => (
                <div className="autolinks__preview-row" role="listitem" key={`${l.source}\u0000${l.target}`}>
                  <span className="autolinks__preview-names">
                    {name(l.source)} <span className="autolinks__arrow">→</span> {name(l.target)}
                  </span>
                  <span className="autolinks__preview-score" title={bonuses(l)}>
                    {l.sem.toFixed(2)} · {l.total.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Row
        label="Mode"
        hint="Auto writes up to 2 links into the property and says so in the status bar, with Undo. Suggest shows chips instead and writes nothing until you click one."
      >
        <div className="segmented segmented--inline">
          {(['off', 'suggest', 'auto'] as const).map((mode) => (
            <button
              key={mode}
              className={`segmented__tab${settings.mode === mode ? ' is-active' : ''}`}
              onClick={() => update({ mode })}
            >
              <span>{mode}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row label="Model" hint={modelLine(status.model)}>
        {status.model.state !== 'ready' && (
          <button
            className="btn btn--sm"
            disabled={status.model.state === 'downloading'}
            onClick={() => void api.invoke('autolinks:download')}
          >
            {status.model.state === 'downloading' ? 'Downloading…' : 'Download model'}
          </button>
        )}
      </Row>
      {status.model.state === 'downloading' && (
        <div className="autolinks__bar" aria-hidden>
          <span style={{ width: `${(status.model.received / status.model.bytes) * 100}%` }} />
        </div>
      )}

      <Row label="Notes read" hint={backfillLine(status)}>
        <span />
      </Row>

      <Group title="When">
        <Row label="Quiet period" hint={`A note is looked at once it has been left alone for ${settings.quietMinutes} min.`}>
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
        <Row label="Minimum words" hint={`Notes with fewer than ${settings.minWords} words of their own get no suggestions.`}>
          <input
            className="slider"
            type="range"
            min={20}
            max={300}
            step={10}
            value={settings.minWords}
            onChange={(event) => update({ minWords: Number(event.target.value) })}
          />
        </Row>
      </Group>

      <Group title="What">
        <Row label="Chips per note" hint="Suggest mode shows at most this many. Auto always adds at most 2.">
          <div className="segmented segmented--inline">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`segmented__tab${settings.maxLinks === n ? ' is-active' : ''}`}
                onClick={() => update({ maxLinks: n })}
              >
                <span>{n}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Property" hint="The only thing auto-links ever writes. Your Links and the note's text are never touched.">
          <CommitField value={settings.property} label="Property name" onCommit={(property) => update({ property })} />
        </Row>
        <Row
          label="Generic names"
          hint="A note with one of these names never gets the bonus for being mentioned by name. Comma separated, any case."
        >
          <CommitField
            value={settings.genericNames.join(', ')}
            label="Generic names"
            onCommit={(raw) =>
              update({
                genericNames: raw
                  .split(',')
                  .map((n) => n.trim())
                  .filter((n) => n !== ''),
              })
            }
          />
        </Row>
        <Row
          label="Excluded folders"
          hint="Comma separated. Daily notes, templates, chats, tasks and attachments are always left out."
        >
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
      </Group>

      <Group title="Thresholds">
        <Row
          label="Auto"
          hint={
            settings.tAuto === null
              ? 'Measured once every note has been read: the top 1% of 500 random pairs in this vault, never under 0.75.'
              : `A link is added at ${status.tAutoEffective?.toFixed(2) ?? '—'} and removed below ${((status.tAutoEffective ?? 0) * 0.85).toFixed(2)}. Measured ${settings.tAuto.toFixed(2)} — the top 1% of 500 random pairs here${
                  feedback.raisedBy > 0 ? `, raised by ${feedback.raisedBy.toFixed(2)} because you deleted too many` : ''
                }.`
          }
        >
          <span className="autolinks__count">{status.tAutoEffective?.toFixed(2) ?? '—'}</span>
        </Row>
        <Row
          label="Suggest"
          hint={
            settings.tSuggest === null
              ? 'Measured with Auto: the top 5% of random pairs, never under 0.70. Suggest mode only.'
              : `A chip needs ${settings.tSuggest.toFixed(2)} — the top 5% of random pairs here. Suggest mode only. Re-measured weekly.`
          }
        >
          <span className="autolinks__count">{settings.tSuggest?.toFixed(2) ?? '—'}</span>
        </Row>
        <Row
          label="Last run"
          hint={
            status.lastRun === null
              ? 'Nothing from the most recent run is still in place. At most 20 notes are written per run, so a first run spreads over a few.'
              : `${status.lastRun.links} ${status.lastRun.links === 1 ? 'link' : 'links'} in ${status.lastRun.notes} ${
                  status.lastRun.notes === 1 ? 'note' : 'notes'
                }, ${new Date(status.lastRun.at).toLocaleString()}. Undoing removes them and never adds those pairs again.`
          }
        >
          <button
            className="btn btn--ghost btn--sm"
            disabled={status.lastRun === null}
            onClick={() => void api.invoke('autolinks:undo-last-run')}
          >
            Undo last run
          </button>
        </Row>
        <Row
          label="Your corrections"
          hint={
            feedback.added === 0
              ? 'Delete an auto-link and it never comes back; move it into Links and it is yours. If you delete more than a third of 20 in a row, the Auto bar goes up by 0.02.'
              : `${feedback.added} added · ${feedback.deleted} deleted · ${feedback.confirmed} moved into your links. More than a third of 20 in a row deleted raises the Auto bar by 0.02, up to 0.90; it never goes down on its own.`
          }
        >
          <span />
        </Row>
        <Row
          label="Check against your links"
          hint={
            status.calibrating !== null
              ? `Checking ${status.calibrating.done} of ${status.calibrating.total} links…`
              : diagnostic === null
                ? 'A diagnostic: hides each of your own links in turn and sees whether it would come back. Links to hub notes and between near-duplicates are left out. It sets nothing.'
                : `On ${diagnostic.links} links (hubs and near-duplicates left out): ${
                    diagnostic.chosen === null
                      ? 'no threshold reaches 70% precision.'
                      : `at ${diagnostic.chosen.toFixed(2)}, ${pct(diagnosticRow?.precision ?? 0)} precision, ${pct(diagnosticRow?.recall ?? 0)} recall.`
                  } A diagnostic only.`
          }
        >
          <button
            className="btn btn--ghost btn--sm"
            disabled={status.model.state !== 'ready' || status.calibrating !== null}
            onClick={() => {
              setCalibrationError(null)
              void api.invoke('autolinks:calibrate').then((result) => {
                if (!result.ok) setCalibrationError(result.error ?? 'The check failed.')
              })
            }}
          >
            {status.calibrating !== null ? 'Checking…' : 'Check'}
          </button>
        </Row>
        {calibrationError !== null && (
          <p className="setting__note setting__note--error" role="alert">
            <Icon name="alert-triangle" size={13} />
            {calibrationError}
          </p>
        )}
      </Group>

      <Row
        label="Rejected suggestions"
        hint={`${status.rejected} ${status.rejected === 1 ? 'pair' : 'pairs'} — kept in .recto/autolinks.json, never suggested again.`}
      >
        <button
          className="btn btn--ghost btn--sm"
          disabled={status.rejected === 0}
          onClick={() => void api.invoke('autolinks:clear-rejections')}
        >
          Clear rejections
        </button>
      </Row>
    </>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
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

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="settings__group">
      <h3 className="settings__grouphead">{title}</h3>
      {children}
    </section>
  )
}
