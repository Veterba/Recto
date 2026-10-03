import { useEffect, useState } from 'react'
import { AI_MODELS } from '@shared/ai'
import type { ModelChoice } from '@shared/bots'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { GlassMenu, type GlassMenuEntry } from './GlassMenu'

/**
 * The model a bot answers with: a chip in the composer, and the menu it opens.
 * The menu lists the chat models installed in Ollama, the recommended ones not
 * downloaded yet (a download asks first), and the API models.
 */

/** "qwen3.5:9b" → ["qwen3.5", "9b"]; an API model → its label. */
export function shortModel(model: string): [string, string | null] {
  const api_ = AI_MODELS.find((m) => m.id === model)
  if (api_ !== undefined) return [api_.label, null]
  const [name, tag] = model.split(':')
  return [name ?? model, tag === undefined || tag === 'latest' ? null : tag]
}

export const modelLabel = (model: string): string => shortModel(model).filter(Boolean).join(' · ')

const gb = (bytes: number, digits: number): string => `${(bytes / 1e9).toFixed(digits).replace(/\.0$/, '')} GB`

export function ModelChip({ model, open, onToggle }: { model: string; open: boolean; onToggle: () => void }): React.ReactElement {
  const [name, tag] = shortModel(model)
  return (
    <button
      className={`composer__chip${open ? ' is-open' : ''}`}
      data-menu-anchor=""
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onToggle}
    >
      <b>{name}</b>
      {tag !== null && <span> · {tag}</span>}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

type Props = {
  current: string
  keyPresent: boolean
  /** A download in progress: its model can't be picked again meanwhile. */
  pulling: string | null
  onPick: (model: string) => void
  onDownload: (model: string) => void
  onClose: () => void
  /** For snapshots: the list as it would come from Ollama. */
  preset?: { local: ModelChoice[]; ramBytes: number }
}

export function ModelMenu({ current, keyPresent, pulling, onPick, onDownload, onClose, preset }: Props): React.ReactElement {
  const [models, setModels] = useState<{ local: ModelChoice[]; ramBytes: number } | null>(preset ?? null)
  const [confirm, setConfirm] = useState<ModelChoice | null>(null)

  useEffect(() => {
    if (preset !== undefined) return
    let cancelled = false
    void api.invoke(IPC.botsModels).then((list) => {
      if (!cancelled) setModels(list)
    })
    return () => {
      cancelled = true
    }
  }, [preset])

  const ram = models === null ? '' : ` · ${Math.round(models.ramBytes / 2 ** 30)} GB`
  const entries: GlassMenuEntry[] = [{ kind: 'head', label: `On this Mac${ram}` }]
  for (const choice of models?.local ?? []) {
    const downloading = pulling === choice.name
    entries.push({
      kind: 'item',
      key: choice.name,
      label: modelLabel(choice.name),
      sub: choice.fits ? choice.hint : 'Too big for this Mac',
      mark: choice.name === current ? '✓' : '',
      right: downloading ? 'Downloading…' : choice.installed ? gb(choice.bytes, 1) : `Download · ${gb(choice.bytes, 0)}`,
      rightAction: !choice.installed && choice.fits && !downloading,
      disabled: !choice.fits || downloading,
      run: () => (choice.installed ? onPick(choice.name) : setConfirm(choice)),
    })
  }
  if (models !== null && models.local.length === 0) entries.push({ kind: 'head', label: 'Ollama is not running' })
  entries.push({ kind: 'sep' }, { kind: 'head', label: 'API' })
  // Without a key the API models are one line that says what they need.
  if (!keyPresent)
    entries.push({
      kind: 'item',
      key: 'api',
      label: 'Claude',
      sub: 'Notes go to Anthropic · needs a key',
      right: 'Settings → AI',
      disabled: true,
      run: () => {},
    })
  else
    for (const entry of AI_MODELS) {
      entries.push({
        kind: 'item',
        key: entry.id,
        label: entry.label,
        sub: `${entry.blurb} Notes go to Anthropic.`,
        mark: entry.id === current ? '✓' : '',
        run: () => onPick(entry.id),
      })
    }

  return (
    <GlassMenu
      className="model-menu"
      label="Model"
      entries={confirm === null ? entries : []}
      onClose={onClose}
      footer={
        confirm !== null && (
          <div className="model-menu__confirm">
            <p>
              Download <b>{modelLabel(confirm.name)}</b>? {gb(confirm.bytes, 1)} from ollama.com. You can keep chatting meanwhile.
            </p>
            <div className="model-menu__buttons">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="is-primary"
                autoFocus
                onClick={() => {
                  onDownload(confirm.name)
                  onClose()
                }}
              >
                Download
              </button>
            </div>
          </div>
        )
      }
    />
  )
}
