import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isPublicAddress,
  parseWebhookUrl,
  resolveWebhookTarget,
  signWebhook,
} from '@/lib/integrations/security'
import {
  createRandomApiToken,
  hashApiToken,
  tokenAllowsRequest,
} from '@/lib/integrations/tokens'

const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => dns)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('scoped API tokens', () => {
  it('reveals a high entropy key whose persisted hash is independent of the secret', () => {
    const first = createRandomApiToken()
    const second = createRandomApiToken()
    expect(first.token).toMatch(/^flr_[\w-]{43}$/)
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashApiToken(first.token)).toBe(first.hash)
    expect(first.token).not.toBe(second.token)
    expect(first.hash).not.toBe(second.hash)
  })
  it('allows only exact route/method combinations and never account or token management', () => {
    const allowed = (method: string, path: string, scopes = ['files:upload']) =>
      tokenAllowsRequest(scopes, { method, url: `https://flare.test${path}` })
    expect(allowed('POST', '/api/files')).toBe(true)
    expect(allowed('PUT', '/api/files/chunks/abc/part/1')).toBe(true)
    expect(allowed('POST', '/api/files/chunks/abc/complete')).toBe(true)
    expect(allowed('GET', '/api/files')).toBe(false)
    expect(allowed('POST', '/api/files', ['files:read'])).toBe(false)
    expect(allowed('GET', '/api/files', ['files:read'])).toBe(true)
    for (const path of [
      '/api/profile',
      '/api/profile/upload-token',
      '/api/profile/sharex',
      '/api/profile/bash',
      '/api/settings',
      '/api/users',
      '/api/integrations',
      '/api/files/a/password',
      '/api/files/chunks/a%2fb/complete',
      '/api/files/',
    ]) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
        expect(
          allowed(method, path, [
            'files:read',
            'files:upload',
            'urls:read',
            'urls:write',
          ])
        ).toBe(false)
    }
    expect(allowed('DELETE', '/api/urls/abc', ['urls:write'])).toBe(true)
    expect(allowed('GET', '/api/urls/abc', ['urls:read'])).toBe(false)
  })
})

describe('webhook destination and signing contracts', () => {
  it('authenticates the timestamp and exact body', () => {
    const body = '{"id":"file.ready:123"}'
    const expected = createHmac('sha256', 'test-secret')
      .update(`123.${body}`)
      .digest('hex')
    expect(signWebhook('test-secret', '123', body)).toBe(`v1=${expected}`)
    expect(signWebhook('test-secret', '124', body)).not.toBe(`v1=${expected}`)
    expect(signWebhook('test-secret', '123', body + ' ')).not.toBe(
      `v1=${expected}`
    )
  })
  it('rejects private, loopback, mapped and transition addresses', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.2.3.4',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fe80::1',
      'fc00::1',
      '2001::1',
      '2001:0db8::1',
      '2002:7f00:1::',
    ])
      expect(isPublicAddress(address), address).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('requires explicit operator opt-in for HTTP or internal DNS answers', async () => {
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    expect(() => parseWebhookUrl('http://localhost:8080/hook')).toThrow('HTTPS')
    expect(() => parseWebhookUrl('https://user:pass@example.com/hook')).toThrow(
      'credentials'
    )
    expect(() => parseWebhookUrl('https://example.com/hook#fragment')).toThrow(
      'fragments'
    )
    dns.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(
      resolveWebhookTarget('https://example.com/hook')
    ).rejects.toThrow('public IP')
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', 'true')
    await expect(
      resolveWebhookTarget('http://localhost/hook')
    ).resolves.toMatchObject({ address: { address: '8.8.8.8' } })
  })
  it('rechecks DNS for every delivery', async () => {
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    dns.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    await expect(
      resolveWebhookTarget('https://example.com')
    ).resolves.toBeDefined()
    await expect(resolveWebhookTarget('https://example.com')).rejects.toThrow(
      'public IP'
    )
    expect(dns.lookup).toHaveBeenCalledTimes(2)
  })
})
