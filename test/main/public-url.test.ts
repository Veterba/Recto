import { describe, expect, it } from 'vitest'
import { privateAddress, publicUrl } from '../../src/main/public-url'

/** A link preview reaches only the public web: never this Mac, the local network or link-local addresses. */
describe('public addresses only', () => {
  it('knows the private and local ranges, IPv4 and IPv6', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
      expect(privateAddress(ip), ip).toBe(true)
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111']) expect(privateAddress(ip), ip).toBe(false)
  })

  it('refuses localhost, .local, literal private addresses and other schemes without looking anything up', async () => {
    for (const url of ['http://localhost:3000/', 'http://router.local/', 'http://192.168.0.1/', 'http://[::1]/', 'file:///etc/hosts', 'ftp://example.org/'])
      expect(await publicUrl(new URL(url)), url).toBe(false)
    expect(await publicUrl(new URL('https://93.184.216.34/'))).toBe(true)
  })
})
