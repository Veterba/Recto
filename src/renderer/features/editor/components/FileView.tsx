import { useState } from 'react'
import { vaultFileUrl } from '../../../app/vault-url'

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i

/** Files opened in the editor. Anything else is shown, not edited. */
const TEXT_FILE = /\.(md|markdown|txt|text|mdx|canvas|json|ya?ml|csv|tsv|log|css|js|ts|tsx|jsx|py|sh|html?|xml|toml|ini)$/i

/** A path with no extension counts as text: that is how plain notes are named elsewhere. */
export const isTextFile = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return !name.includes('.') || TEXT_FILE.test(name)
}

/**
 * A tab for a file that is not a note.
 *
 * Clicking a screenshot in the sidebar used to open its bytes in the markdown
 * editor - unreadable at best, and one such PNG crashed the editor outright.
 * Images are shown as images; anything else says what it is.
 */
export function FileView({ path }: { path: string }): React.ReactElement {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const [failed, setFailed] = useState(false)
  if (IMAGE_FILE.test(name) && !failed) {
    return (
      <div className="file-view">
        <div className="md__bar">
          <span className="md__path">{path}</span>
        </div>
        <div className="file-view__stage">
          <img src={vaultFileUrl(path)} alt={name} onError={() => setFailed(true)} />
        </div>
      </div>
    )
  }
  return (
    <div className="pane-empty">
      <p>
        <code>{name}</code>
        <br />
        {failed ? 'This image could not be loaded.' : 'This file is not a note, so Recto does not open it as text.'}
      </p>
    </div>
  )
}
