import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loginMetadata } from '@/lib/auth/sessions'
import { clientIp, headerRecord } from '@/lib/security/client-ip'
import {
  rateLimit,
  requestLimit,
  requesterKey,
} from '@/lib/security/rate-limit'

const database = vi.hoisted(() => ({ counts: new Map<string, number>() }))
// The email limit table: one counter per key, in a window that stays open.
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $queryRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      const key = values.find((value) => typeof value === 'string')!
      const count = (database.counts.get(key) ?? 0) + 1
      database.counts.set(key, count)
      return [{ count, resetsIn: 3600 }]
    },
  },
}))
vi.mock('@/lib/audit', () => ({ recordAudit: async () => undefined }))

const { limitEmailRequest } = await import('@/lib/email/rate-limit')
const { DEFAULT_EMAIL_CONFIG } = await import('@/lib/email/schema')

function request(headers: Record<string, string>) {
  return new Request('https://flare.test/api/files', { headers })
}

const real = '203.0.113.9'

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('client address precedence', () => {
  it('ignores a client-supplied leftmost X-Forwarded-For entry when the proxy sets X-Real-IP', () => {
    // nginx with $proxy_add_x_forwarded_for appends the real address to
    // whatever the client sent, while X-Real-IP holds $remote_addr.
    for (const spoofed of ['198.51.100.7', '198.51.100.8', '192.0.2.1']) {
      const headers = {
        'x-real-ip': real,
        'x-forwarded-for': `${spoofed}, ${real}`,
      }
      expect(clientIp(new Headers(headers))).toBe(real)
      expect(loginMetadata(new Headers(headers)).ipAddress).toBe(real)
    }
  })

  it('uses the first X-Forwarded-For entry when X-Real-IP is absent', () => {
    const headers = { 'x-forwarded-for': `${real}, 10.0.0.2` }
    expect(clientIp(new Headers(headers))).toBe(real)
    expect(loginMetadata(new Headers(headers)).ipAddress).toBe(real)
  })

  it('skips values that are not addresses and falls through to the next header', () => {
    for (const invalid of [
      'not-an-ip',
      'unknown',
      '',
      ' ',
      '203.0.113.256',
      '1.2.3',
      'x'.repeat(10_000),
      '203.0.113.9; DROP TABLE',
    ]) {
      const headers = {
        'x-real-ip': invalid,
        'x-forwarded-for': `${real}, 10.0.0.2`,
      }
      expect(clientIp(new Headers(headers))).toBe(real)
    }
    expect(
      clientIp(new Headers({ 'x-forwarded-for': 'garbage, 198.51.100.7' }))
    ).toBeNull()
    expect(clientIp(new Headers({ 'x-real-ip': 'garbage' }))).toBeNull()
    expect(
      loginMetadata(new Headers({ 'x-real-ip': 'garbage' })).ipAddress
    ).toBeNull()
  })

  it('returns no address when no header carries one', () => {
    expect(clientIp(new Headers())).toBeNull()
    expect(loginMetadata(new Headers()).ipAddress).toBeNull()
  })

  it('accepts IPv6, bracketed addresses, ports, and IPv4-mapped forms', () => {
    const cases: [string, string][] = [
      ['2001:db8::1', '2001:db8::1'],
      ['[2001:db8::1]', '2001:db8::1'],
      ['[2001:db8::1]:443', '2001:db8::1'],
      ['203.0.113.9:51234', real],
      ['::ffff:203.0.113.9', real],
      ['  203.0.113.9  ', real],
    ]
    for (const [value, expected] of cases) {
      expect(clientIp(new Headers({ 'x-real-ip': value }))).toBe(expected)
      expect(clientIp(new Headers({ 'x-forwarded-for': value }))).toBe(expected)
    }
  })

  it('gives every spelling of one address the same key', () => {
    const cases: [string, string][] = [
      // IPv4-mapped IPv6, however it is written, is the IPv4 client.
      ['::ffff:cb00:7109', real],
      ['::FFFF:CB00:7109', real],
      ['0:0:0:0:0:ffff:203.0.113.9', real],
      ['0000:0000:0000:0000:0000:ffff:cb00:7109', real],
      ['[::ffff:cb00:7109]:443', real],
      // Other IPv6 addresses use the RFC 5952 form.
      ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
      ['2001:DB8::0:1', '2001:db8::1'],
      ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
      ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
      ['fe80::1%eth0', 'fe80::1'],
      ['0:0:0:0:0:0:0:1', '::1'],
      ['::', '::'],
      // IPv4-compatible (deprecated) is not IPv4-mapped.
      ['::203.0.113.9', '::cb00:7109'],
    ]
    for (const [value, expected] of cases)
      expect(clientIp(new Headers({ 'x-real-ip': value }))).toBe(expected)
  })
})

describe('rate limit keys', () => {
  it('cannot be reset by changing a spoofed X-Forwarded-For entry', async () => {
    const limiter = requestLimit('client-ip-spoofing', 1)
    const first = await rateLimit(
      request({
        'x-real-ip': real,
        'x-forwarded-for': `198.51.100.1, ${real}`,
      }),
      limiter
    )
    expect(first).toBeNull()
    const second = await rateLimit(
      request({
        'x-real-ip': real,
        'x-forwarded-for': `198.51.100.2, ${real}`,
      }),
      limiter
    )
    expect(second?.status).toBe(429)
  })

  it('counts requests without an address as the loopback address in per-process limits', async () => {
    const limiter = requestLimit('client-ip-missing', 1)
    expect(await rateLimit(request({}), limiter)).toBeNull()
    expect(
      (await rateLimit(request({ 'x-real-ip': '127.0.0.1' }), limiter))?.status
    ).toBe(429)
    expect(requesterKey(request({}))).toBe('ip:127.0.0.1')
    expect(requesterKey(request({ 'x-real-ip': real }))).toBe(`ip:${real}`)
  })
})

describe('other limiters', () => {
  // A second request that shares the first one's key is refused.
  const oncePerHour = {
    ...DEFAULT_EMAIL_CONFIG,
    limits: { ...DEFAULT_EMAIL_CONFIG.limits, ipPerHour: 1 },
  }

  beforeEach(() => database.counts.clear())

  it('keys the email request limit on the same address', async () => {
    await limitEmailRequest(
      request({
        'x-real-ip': real,
        'x-forwarded-for': `198.51.100.3, ${real}`,
      }),
      oncePerHour
    )
    await expect(
      limitEmailRequest(
        request({
          'x-real-ip': real,
          'x-forwarded-for': `198.51.100.4, ${real}`,
        }),
        oncePerHour
      )
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      limitEmailRequest(request({ 'x-real-ip': '192.0.2.10' }), oncePerHour)
    ).resolves.toBeUndefined()
  })

  it('counts email requests without an address together', async () => {
    await limitEmailRequest(request({}), oncePerHour)
    await expect(
      limitEmailRequest(request({}), oncePerHour)
    ).rejects.toMatchObject({ status: 429 })
  })

  it('reads the header records NextAuth passes to sign-in providers', () => {
    expect(
      clientIp(
        headerRecord({
          'x-real-ip': real,
          'x-forwarded-for': `198.51.100.4, ${real}`,
        })
      )
    ).toBe(real)
    expect(clientIp(headerRecord({ 'x-real-ip': [real, '10.0.0.9'] }))).toBe(
      real
    )
    expect(clientIp(headerRecord(undefined))).toBeNull()
  })
})

describe('FLARE_CLIENT_IP_HEADER', () => {
  it('is off by default', () => {
    const headers = { 'cf-connecting-ip': '192.0.2.44', 'x-real-ip': real }
    expect(clientIp(new Headers(headers))).toBe(real)
  })

  it('reads only the configured header when set', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'CF-Connecting-IP')
    const headers = {
      'cf-connecting-ip': '192.0.2.44',
      'x-real-ip': real,
      'x-forwarded-for': '198.51.100.7',
    }
    expect(clientIp(new Headers(headers))).toBe('192.0.2.44')
    expect(loginMetadata(new Headers(headers)).ipAddress).toBe('192.0.2.44')
  })

  it('does not fall back to other headers when the configured one is missing or invalid', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'cf-connecting-ip')
    const missing = { 'x-real-ip': real, 'x-forwarded-for': '198.51.100.7' }
    expect(clientIp(new Headers(missing))).toBeNull()
    expect(loginMetadata(new Headers(missing)).ipAddress).toBeNull()
    const invalid = { ...missing, 'cf-connecting-ip': 'not-an-ip' }
    expect(clientIp(new Headers(invalid))).toBeNull()
  })

  it('uses the first entry of a configured list header', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'X-Forwarded-For')
    expect(
      clientIp(
        new Headers({
          'x-real-ip': real,
          'x-forwarded-for': '192.0.2.44, 10.0.0.2',
        })
      )
    ).toBe('192.0.2.44')
  })

  it('ignores an empty or malformed setting', () => {
    for (const value of ['', '  ', 'not a header', 'X-Real-IP:']) {
      vi.stubEnv('FLARE_CLIENT_IP_HEADER', value)
      expect(
        clientIp(
          new Headers({ 'x-real-ip': real, 'x-forwarded-for': '198.51.100.7' })
        )
      ).toBe(real)
    }
  })
})
