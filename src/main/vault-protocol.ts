import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveInVault } from './paths'
import { currentVault } from './vault'

/**
 * `recto-file://vault/<path>` — how the renderer loads an image out of the vault.
 *
 * A plain `file://` URL cannot work, and this is why images never rendered: the
 * renderer's origin is `http://localhost` in dev and `file://` from the app
 * bundle in a build, and Chromium refuses a local-resource load from the first
 * and treats the second as a cross-directory read. `webSecurity: false` would
 * "fix" it by removing the one thing keeping a markdown bug away from the disk.
 *
 * So: one scheme, one host, and every path through `resolveInVault`. A note
 * that says `![](../../../.ssh/id_rsa)` gets a 403, not a file.
 */

const SCHEME = 'recto-file'

/** Must run before `app.whenReady()`, or the scheme has no privileges. */
export function registerVaultScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true },
    },
  ])
}

/** Must run after ready. */
export function handleVaultScheme(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'vault') return new Response('bad host', { status: 400 })

    const vault = currentVault()
    if (vault === null) return new Response('no vault', { status: 404 })

    let relative: string
    try {
      relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('bad path', { status: 400 })
    }
    if (relative === '') return new Response('bad path', { status: 400 })

    let absolute: string
    try {
      absolute = resolveInVault(vault.path, relative)
    } catch {
      return new Response('forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(absolute).toString())
  })
}
