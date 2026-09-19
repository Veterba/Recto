/**
 * Markdown, flattened to the words a search result is about.
 *
 * A result line came straight out of the index, so it read
 * `# Contrastive Learning Notes on contrastive learning. ## Related - [[Batch
 * Normalization]]` - every hash, bracket and bullet competing with the sentence
 * you are scanning for. This strips the syntax and keeps the text, which is all
 * a snippet was ever showing.
 *
 * Deliberately not a parser: it runs on a hundred short strings per keystroke,
 * and a snippet is usually a fragment - an unbalanced `**` or half a link is
 * normal here, and a parser would either choke or need a document around it.
 *
 * FTS5's `<<`/`>>` match markers pass through untouched, including when they
 * sit inside something that gets unwrapped, so the highlight still lands on the
 * word that matched.
 */
export function plainSnippet(text: string): string {
  return (
    text
      // `[[note|alias]]` and `[[note#heading]]` read as their visible half.
      .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) =>
        (alias ?? target).trim(),
      )
      // `![alt](src)` and `[text](href)` keep the part a reader would have read.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Line furniture: heading hashes, bullets, numbers, quote marks.
      .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/g, '$1')
      // Emphasis, code and highlight marks, which only ever wrapped text.
      .replace(/(\*\*|__|~~|==|\*|_|`)/g, '')
      // Whatever whitespace the flattening left behind.
      .replace(/[ \t]*\n+[ \t]*/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}
