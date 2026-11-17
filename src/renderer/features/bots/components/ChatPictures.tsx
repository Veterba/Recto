import { pictureRefs, VIDEO_FILE } from '@shared/chat-pictures'
import { resolveVaultFile, vaultFileUrl } from '../../../app/vault-url'

/** The pictures and videos a message of mine embeds, in a row; nothing when it has none. A video plays here. */
export function ChatPictures({ text }: { text: string }): React.ReactElement | null {
  const pictures = pictureRefs(text)
  if (pictures.length === 0) return null
  return (
    <div className="msg-mine__pictures">
      {pictures.map((p, i) => {
        const path = resolveVaultFile(p.target) ?? p.target
        return (
          <span key={i} className="msg-mine__picture">
            {p.kind === 'video' ? (
              <video src={vaultFileUrl(path)} controls preload="metadata" aria-label={path.slice(path.lastIndexOf('/') + 1)} />
            ) : (
              <img src={vaultFileUrl(path)} alt={path.slice(path.lastIndexOf('/') + 1)} />
            )}
          </span>
        )
      })}
    </div>
  )
}

/** A picture or a video waiting to be sent, small: a video shows its first frame, with ▶ on it. */
export function MediaThumb({ path }: { path: string }): React.ReactElement {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!VIDEO_FILE.test(path)) return <img src={vaultFileUrl(path)} alt={name} />
  return (
    <>
      <video src={vaultFileUrl(path)} muted preload="metadata" aria-label={name} />
      <span className="composer__picture-play" aria-hidden="true">
        ▶
      </span>
    </>
  )
}
