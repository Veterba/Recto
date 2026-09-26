/**
 * Wikilink targets in a document.
 *
 * A renderer-side copy of the same rule the main process uses: the two run in
 * different processes and cannot share a module, so the regex and the
 * code-fence rule are duplicated deliberately. If one changes, change both -
 * that is why the comment is here rather than a shrug.
 */

const FENCE = /^\s*(```|~~~)/
const WIKILINK = /\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g

export function extractTargets(text: string): string[] {
  const found = new Set<string>()
  let inCode = false

  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    for (const match of line.matchAll(WIKILINK)) {
      const target = match[1]?.trim()
      if (target !== undefined && target !== '') found.add(target)
    }
  }
  return [...found]
}
