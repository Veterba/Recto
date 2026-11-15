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
    // An IPv4 address inside an IPv6 one - mapped (::ffff:), compatible (::) or NAT64 (64:ff9b::) - is that IPv4
    // address. The URL parser writes [::ffff:127.0.0.1] as ::ffff:7f00:1, so the hex form is read too.
    const v4 = /^(?:::ffff:|::|64:ff9b::)(.+)$/.exec(v6)?.[1]
    if (v4 !== undefined && v4 !== '1' && v4 !== '') return privateAddress(isIP(v4) === 4 ? v4 : fromHex(v4))
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

/** `7f00:1` as `127.0.0.1`; anything else as an address that is private (unreadable, so not trusted). */
function fromHex(groups: string): string {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(groups)
  if (m === null) return '0.0.0.0'
  const [hi, lo] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16)]
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
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
