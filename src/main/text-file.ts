/**
 * Is this file text we may open and save?
 *
 * A screenshot opened as a note was decoded as UTF-8 - every byte that is not
 * valid UTF-8 became U+FFFD - and the next save wrote that back over the PNG,
 * destroying it. Nothing on the way checked, because every path assumed a note
 * is text. This is the check, and it lives in main so no renderer bug can get
 * around it.
 *
 * Two ways a file fails: a NUL byte in the first 8 KB (no text format uses one,
 * every image and PDF does), or bytes that are not valid UTF-8 - which is a
 * note saved in UTF-16 or a legacy encoding, not a damaged one. They get
 * different messages, because the second is worth explaining.
 */
const SNIFF = 8192

export type NotText = 'binary' | 'encoding'

/**
 * @param partial `data` is only the beginning of the file, so the last
 * character may be cut in half. Without this, a note whose 8192nd byte lands
 * inside a Cyrillic letter or an em-dash was read as binary - and since the
 * write guard reads exactly 8192 bytes, saving such a note was refused with
 * "Refused to overwrite a file that is not text".
 */
export function notTextReason(data: Uint8Array, partial = false): NotText | null {
  const head = data.subarray(0, SNIFF)
  if (head.includes(0)) return 'binary'
  try {
    // `stream: true` so a multi-byte character cut off at the end of what we
    // looked at does not count as invalid.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: partial || data.length > SNIFF })
    return null
  } catch {
    return 'encoding'
  }
}

export const looksBinary = (data: Uint8Array, partial = false): boolean => notTextReason(data, partial) !== null

/** What to tell the user, in full sentences, about a file Recto will not treat as a note. */
export function notTextMessage(reason: NotText, writing: boolean): string {
  if (reason === 'binary') {
    return writing
      ? 'Not saved: the file on disk holds binary data, not text, and writing over it would destroy it.'
      : 'This file holds binary data, not text, so it is not opened as a note.'
  }
  return writing
    ? 'Not saved: the file on disk is not UTF-8 text - it may be UTF-16 or a legacy encoding - and writing over it would lose characters.'
    : 'This file is not UTF-8 text. It may be UTF-16 or a legacy encoding, which Recto does not convert on its own.'
}
