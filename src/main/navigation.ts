/**
 * Navigation policy for the renderer.
 *
 * The window must never navigate away from the app bundle, but it MUST be able
 * to navigate to itself - a page-initiated `location.reload()` fires
 * `will-navigate`, so a blanket preventDefault() silently breaks reload.
 */
export function isAppUrl(url: string, appEntry: string): boolean {
  let target: URL
  let origin: URL
  try {
    target = new URL(url)
    origin = new URL(appEntry)
  } catch {
    return false
  }
  if (target.protocol !== origin.protocol) return false
  // file: URLs have a null origin, so compare the document path instead.
  if (target.protocol === 'file:') return target.pathname === origin.pathname
  return target.origin === origin.origin
}
