import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Only the public web: never this Mac, the local network or a link-local
 * address. A canvas is a file anyone could have made, and its link must not
 * be able to make Recto knock on a router or a service on localhost.
 */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase()
    if (v6.startsWith('::ffff:')) return privateAddress(v6.slice(7))
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
  }
  const [a = 0, b = 0] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

export async function publicUrl(url: URL): Promise<boolean> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false
  try {
    const addresses = isIP(host) === 0 ? await lookup(host, { all: true }) : [{ address: host }]
    return addresses.length > 0 && addresses.every((a) => !privateAddress(a.address))
  } catch {
    return false
  }
}
