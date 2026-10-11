import { extractTargets, pathsByName, resolveLink } from '../../shared/parse'

/**
 * link_status: every [[link]] in a note and whether a note by that name
 * exists - so Recto can answer "which links in this note are broken?" from
 * fact instead of saying it cannot check. Read-only, like every bot tool.
 */

export type LinkStatus = { target: string; exists: boolean; path: string | null }

export function linkStatus(content: string, vaultPaths: readonly string[]): LinkStatus[] {
  const byName = pathsByName(vaultPaths)
  const all = new Set(vaultPaths)
  return extractTargets(content).map((raw) => {
    // "Note#Heading" and "Note|alias" link to Note.
    const target = raw.split(/[#|]/)[0]!.trim()
    const path = target === '' ? null : resolveLink(target, byName, all)
    return { target: target === '' ? raw : target, exists: path !== null, path }
  })
}

/** The tool's text, as the model reads it. */
export function linkStatusText(title: string, links: readonly LinkStatus[]): string {
  if (links.length === 0) return `"${title}" has no [[links]].`
  const missing = links.filter((l) => !l.exists).length
  return [
    `Links in "${title}": ${links.length}, ${missing === 0 ? 'all to existing notes' : `${missing} to notes that don't exist`}.`,
    ...links.map((l) => `- [[${l.target}]] - ${l.exists ? 'exists' : 'no such note'}`),
  ].join('\n')
}

/** Is the question about the links in a note? Then the harness checks them (prepare.ts). */
export const asksAboutLinks = (question: string): boolean =>
  /\[\[|ссылк|линк|\blinks?\b|\blinked\b|\blenk(e|er|ene)?\b|backlink/i.test(question)
