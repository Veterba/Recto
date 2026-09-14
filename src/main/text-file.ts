/**
 * Is this file text we may open and save?
 *
 * A screenshot opened as a note was decoded as UTF-8 - every byte that is not
 * valid UTF-8 became U+FFFD - and the next save wrote that back over the PNG,
 * destroying it. Nothing on the way checked, because every path assumed a note
 * is text. This is the check, and it lives in main so no renderer bug can get
 * around it.
 *
 * Binary means: a NUL byte anywhere in the first 8 KB (no text format uses one,
 * every image and PDF does), or bytes that are not valid UTF-8.
 */
const SNIFF = 8192

export function looksBinary(data: Uint8Array): boolean {
  const head = data.subarray(0, SNIFF)
  if (head.includes(0)) return true
  try {
    // `stream: true` so a multi-byte character cut off at the sniff boundary
    // does not count as invalid.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: data.length > SNIFF })
    return false
  } catch {
    return true
  }
}
