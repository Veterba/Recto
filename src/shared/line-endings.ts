/**
 * Line endings, kept as the file had them.
 *
 * Edits here work on `\n` lines. A note synced from Windows is CRLF, and every
 * edit that split on `/\r?\n/` and joined on `\n` quietly rewrote all of its
 * lines - a whole-file diff for a one-key change. A file goes back CRLF when
 * every break in it was CRLF; a file that mixes both comes out `\n`, since
 * there is no single ending to restore.
 */
export const isCrlf = (text: string): boolean => text.includes('\r\n') && !/(?<!\r)\n/.test(text)

export const toLf = (text: string): string => text.replace(/\r\n/g, '\n')

/** `\n` text back in CRLF when `crlf`. */
export const withEndings = (text: string, crlf: boolean): string => (crlf ? text.replace(/\n/g, '\r\n') : text)

/** Run a `\n`-only edit on `text` and give the result back in `text`'s line endings. */
export function keepLineEndings(text: string, edit: (lf: string) => string): string {
  const crlf = isCrlf(text)
  return withEndings(edit(crlf ? toLf(text) : text), crlf)
}
