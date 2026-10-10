import { useState } from 'react'
import { fileKind } from '@shared/file-kind'
import { IPC } from '@shared/ipc'
import { api } from '../../../app/api'
import { vaultFileUrl } from '../../../app/vault-url'
import { Icon } from '../../../ui/Icon'

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`

/**
 * A file Recto shows but does not edit: what it is, and the way out.
 *
 * Every file that opens in a tab ends somewhere useful - the note editor, the
 * code editor, a preview, or this card with Show in Finder - never a blank.
 */
export function BinaryCard({
  path,
  reason,
  size,
}: {
  path: string
  reason?: string | undefined
  size?: number | undefined
}): React.ReactElement {
  return (
    <div className="note-error">
      <div className="note-error__card file-card">
        <Icon name="file" size={18} className="note-error__icon" />
        <p className="note-error__title">{nameOf(path)}</p>
        <code className="note-error__path">{path}</code>
        <p className="note-error__detail">
          {reason ?? 'Recto cannot show this kind of file.'}
          {size !== undefined && size > 0 ? ` ${sizeLabel(size)}.` : ''}
        </p>
        <div className="note-error__actions">
          <button className="btn btn--sm" onClick={() => void api.invoke(IPC.fsReveal, path)}>
            Show in Finder
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * An image or a PDF, previewed in its tab.
 *
 * Clicking a screenshot in the sidebar used to open its bytes in the markdown
 * editor - unreadable at best, and one such PNG crashed the editor outright.
 * Images are shown as images and PDFs in Chromium's own viewer; one that fails
 * to load falls back to the card.
 */
export function FileView({ path }: { path: string }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  const kind = fileKind(path)
  if (failed || (kind !== 'image' && kind !== 'pdf')) {
    return <BinaryCard path={path} reason={failed ? 'This file could not be loaded.' : undefined} />
  }
  return (
    <div className="file-view">
      <div className="md__bar">
        <span className="md__path">{path}</span>
        <button className="btn btn--ghost btn--sm" onClick={() => void api.invoke(IPC.fsReveal, path)}>
          Show in Finder
        </button>
      </div>
      <div className={`file-view__stage file-view__stage--${kind}`}>
        {kind === 'image' ? (
          <img src={vaultFileUrl(path)} alt={nameOf(path)} onError={() => setFailed(true)} />
        ) : (
          <iframe className="file-view__pdf" src={vaultFileUrl(path)} title={nameOf(path)} />
        )}
      </div>
    </div>
  )
}
