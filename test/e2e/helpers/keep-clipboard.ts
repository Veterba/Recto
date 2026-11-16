import { execFileSync } from 'node:child_process'

/**
 * The e2e apps copy and paste through the Mac's own clipboard, shared with
 * whoever is working: a canvas card copied by a test would be there for their
 * next paste. Its text is kept before the run and put back after it. Text only
 * (pbcopy): a picture on the clipboard is not kept.
 */
export default function keepClipboard(): (() => void) | undefined {
  if (process.env['RECTO_E2E'] !== '1' || process.platform !== 'darwin') return undefined
  const text = execFileSync('pbpaste', { encoding: 'utf8' })
  return () => {
    execFileSync('pbcopy', { input: text })
  }
}
