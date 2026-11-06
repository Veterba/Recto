import { nameWarnings } from '@shared/obsidian-links'

/**
 * Under a field where a file is named: what to know about the name typed,
 * before it is made - links that will not find it, Windows, a hidden file.
 * The name is allowed and never changed (shared/obsidian-links.ts `nameWarnings`).
 */
export function NameWarning({ name }: { name: string }): React.ReactElement | null {
  const warnings = nameWarnings(name)
  if (warnings.length === 0) return null
  return (
    <p className="name-warning" role="status">
      {warnings.join(' ')}
    </p>
  )
}
