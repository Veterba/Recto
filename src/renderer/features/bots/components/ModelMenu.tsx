import { useEffect, useState } from 'react'
import { AI_MODELS } from '@shared/ai'
import type { ModelChoice } from '@shared/bots'
import { IPC } from '@shared/ipc'
import {
  isCloudModel,
  limitsLine,
  modelPart,
  modelString,
  providerInfo,
  providerOf,
  usageLine,
  VENDORS,
  type ProviderId,
  type ProviderStatus,
  type Vendor,
} from '@shared/providers'
import { api } from '../../../app/api'
import { openSettingsAt } from '../../../app/settings-request'
import { GlassMenu, type GlassMenuEntry } from './GlassMenu'

/**
 * Where an answer comes from: a chip in the composer, and the menu it opens.
 * "On this Mac": the chat models installed in Ollama and the recommended ones
 * not downloaded yet (a download asks first). "Cloud": each provider and its
 * models - only where cloud is allowed (Recto's chat and Quick ask), and each
 * one that cannot answer yet says why, with Settings one click away.
 */

/** "qwen3.5:9b" → ["qwen3.5", "9b"]; a cloud model → its provider and model. */
export function shortModel(model: string): [string, string | null] {
  const provider = providerOf(model)
  if (provider !== 'ollama') {
    const inner = modelPart(model)
    const name = providerInfo(provider).name.replace(' API key', '')
    return [name, inner === '' ? null : (AI_MODELS.find((m) => m.id === inner)?.label ?? inner)]
  }
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
      <span className={`composer__where${isCloudModel(model) ? ' is-cloud' : ''}`}>{isCloudModel(model) ? 'cloud' : 'on this Mac'}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

type Props = {
  current: string
  /** Cloud providers may answer here: Recto's chat and Quick ask; other bots stay on this Mac. */
  cloud: boolean
  /** A download in progress: its model can't be picked again meanwhile. */
  pulling: string | null
  onPick: (model: string) => void
  onDownload: (model: string) => void
  onClose: () => void
  /** For snapshots: the list as it would come from Ollama. */
  preset?: { local: ModelChoice[]; ramBytes: number }
}

export function ModelMenu({ current, cloud, pulling, onPick, onDownload, onClose, preset }: Props): React.ReactElement {
  const [models, setModels] = useState<{ local: ModelChoice[]; ramBytes: number } | null>(preset ?? null)
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [cloudOn, setCloudOn] = useState<boolean | null>(null)
  const [confirm, setConfirm] = useState<ModelChoice | null>(null)
  /** A maker's page in the cloud part, or the first page. */
  const [vendor, setVendor] = useState<Vendor | null>(null)

  useEffect(() => {
    let cancelled = false
    if (preset === undefined)
      void api.invoke(IPC.botsModels).then((list) => {
        if (!cancelled) setModels(list)
      })
    if (cloud) {
      void api.invoke(IPC.aiAccessSettings).then((s) => !cancelled && setCloudOn(s.cloud))
      void api.invoke(IPC.providers).then((list) => !cancelled && setProviders(list))
    }
    return () => {
      cancelled = true
    }
  }, [preset, cloud])

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
  const cloudPart = cloud ? cloudEntries(current, providers, cloudOn, vendor, setVendor, onPick) : []
  // On a maker's page the menu is that page only.
  const shown: GlassMenuEntry[] =
    vendor !== null ? cloudPart : cloud ? [...entries, { kind: 'sep' }, { kind: 'head', label: 'Cloud · your notes leave this Mac' }, ...cloudPart] : entries

  return (
    <GlassMenu
      className="model-menu"
      label="Model"
      entries={confirm === null ? shown : []}
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

/** A maker's mark in the menu: a monogram, not their logo. */
export function VendorMark({ vendor }: { vendor: Vendor }): React.ReactElement {
  return (
    <span className={`vendor-mark vendor-mark--${vendor}`} aria-hidden="true">
      {vendor === 'anthropic' ? 'A' : 'O'}
    </span>
  )
}

/** How a way in is called inside its maker's page: "Claude Code", "API key". */
const shortName = (id: ProviderId): string => providerInfo(id).name.replace(/^(OpenAI|Anthropic) /, '')

/**
 * The cloud part of the menu. First a row per maker (Anthropic, OpenAI) with
 * its mark and what is ready; picked, the maker's page lists each way in -
 * its CLI, plan or key - with its limits and its models. One that cannot
 * answer yet says why, with Settings one click away.
 */
function cloudEntries(
  current: string,
  providers: ProviderStatus[] | null,
  cloudOn: boolean | null,
  vendor: Vendor | null,
  setVendor: (vendor: Vendor | null) => void,
  onPick: (model: string) => void,
): GlassMenuEntry[] {
  const settings = (): void => openSettingsAt('ai')
  if (cloudOn === false)
    return [{ kind: 'item', key: 'cloud-off', label: 'Off for this vault', sub: 'Answers stay on this Mac.', right: 'Turn on…', rightAction: true, run: settings }]
  if (providers === null) return [{ kind: 'head', label: 'Looking…' }]
  const of = (v: Vendor): ProviderStatus[] => providers.filter((p) => providerInfo(p.id).vendor === v)
  const currentVendor = providerInfo(providerOf(current)).vendor

  if (vendor === null)
    return VENDORS.map((v) => {
      const ways = of(v.id)
      const ready = ways.filter((p) => p.ready)
      return {
        kind: 'item' as const,
        key: `vendor-${v.id}`,
        icon: <VendorMark vendor={v.id} />,
        label: v.name,
        sub: ready.length === 0 ? 'Nothing set up yet' : ready.map((p) => shortName(p.id)).join(' · '),
        mark: currentVendor === v.id ? '✓' : '',
        right: '›',
        run: () => setVendor(v.id),
      }
    })

  const page: GlassMenuEntry[] = [
    { kind: 'item', key: 'back', icon: <VendorMark vendor={vendor} />, label: `‹ ${VENDORS.find((v) => v.id === vendor)!.name}`, run: () => setVendor(null) },
  ]
  for (const p of of(vendor)) {
    const info = providerInfo(p.id)
    page.push({ kind: 'sep' }, { kind: 'head', label: `${shortName(p.id)}${info.badge === undefined ? '' : ` · ${info.badge}`}` })
    if (!p.ready) {
      page.push({ kind: 'item', key: `setup-${p.id}`, label: p.problem?.message ?? 'Not set up', right: 'Settings…', rightAction: true, run: settings })
      continue
    }
    if (p.limits !== null && p.limits.windows.length > 0)
      page.push({ kind: 'note', text: limitsLine(p.limits), ...(p.limits.blocked ? { tone: 'warn' as const } : {}) })
    page.push({ kind: 'note', text: usageLine(p.usage) })
    const choices = p.models.length > 0 ? p.models : [{ id: '', label: 'Default model' }]
    for (const m of choices) {
      const model = modelString(p.id, m.id)
      page.push({ kind: 'item', key: model, label: m.label, mark: model === current ? '✓' : '', run: () => onPick(model) })
    }
  }
  return page
}
