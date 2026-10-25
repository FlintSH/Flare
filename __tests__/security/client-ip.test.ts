import { createHash } from 'node:crypto'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loginMetadata } from '@/lib/auth/sessions'
import { getClientIp, rateLimit } from '@/lib/security/rate-limit'

const database = vi.hoisted(() => ({ keys: [] as string[] }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $queryRaw: async (_sql: TemplateStringsArray, key: string) => {
      database.keys.push(key)
      return [{ count: 1 }]
    },
  },
}))
vi.mock('@/lib/audit', () => ({ recordAudit: async () => undefined }))

const { requestIp } = await import('@/lib/auth/security/shared')
const { limitEmailRequest } = await import('@/lib/email/rate-limit')
const { DEFAULT_EMAIL_CONFIG } = await import('@/lib/email/schema')
const { headerRecord } = await import('@/lib/security/client-ip')

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
      expect(getClientIp(request(headers))).toBe(real)
      expect(requestIp(new Headers(headers))).toBe(real)
      expect(loginMetadata(new Headers(headers)).ipAddress).toBe(real)
    }
  })

  it('uses the first X-Forwarded-For entry when X-Real-IP is absent', () => {
    const headers = { 'x-forwarded-for': `${real}, 10.0.0.2` }
    expect(getClientIp(request(headers))).toBe(real)
    expect(requestIp(new Headers(headers))).toBe(real)
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
      expect(getClientIp(request(headers))).toBe(real)
      expect(requestIp(new Headers(headers))).toBe(real)
    }
    expect(
      getClientIp(request({ 'x-forwarded-for': 'garbage, 198.51.100.7' }))
    ).toBe('127.0.0.1')
    expect(requestIp(new Headers({ 'x-real-ip': 'garbage' }))).toBe('unknown')
    expect(
      loginMetadata(new Headers({ 'x-real-ip': 'garbage' })).ipAddress
    ).toBeNull()
  })

  it('keeps the fallbacks when no header carries an address', () => {
    expect(getClientIp(request({}))).toBe('127.0.0.1')
    expect(requestIp(new Headers())).toBe('unknown')
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
      expect(getClientIp(request({ 'x-real-ip': value }))).toBe(expected)
      expect(getClientIp(request({ 'x-forwarded-for': value }))).toBe(expected)
    }
  })
})

describe('rate limit keys', () => {
  it('cannot be reset by changing a spoofed X-Forwarded-For entry', async () => {
    const limiter = new RateLimiterMemory({
      points: 1,
      duration: 60,
      keyPrefix: `client-ip-test-${Date.now()}`,
    })
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
})

describe('other limiters', () => {
  it('keys the email request limit on the same address', async () => {
    database.keys.length = 0
    await limitEmailRequest(
      request({
        'x-real-ip': real,
        'x-forwarded-for': `198.51.100.3, ${real}`,
      }),
      DEFAULT_EMAIL_CONFIG
    )
    expect(database.keys[0]).toBe(
      createHash('sha256').update(`email:ip:${real}`).digest('hex')
    )
  })

  it('reads the header records NextAuth passes to sign-in providers', () => {
    expect(
      requestIp(
        headerRecord({
          'x-real-ip': real,
          'x-forwarded-for': `198.51.100.4, ${real}`,
        })
      )
    ).toBe(real)
    expect(requestIp(headerRecord({ 'x-real-ip': [real, '10.0.0.9'] }))).toBe(
      real
    )
    expect(requestIp(headerRecord(undefined))).toBe('unknown')
  })
})

describe('FLARE_CLIENT_IP_HEADER', () => {
  it('is off by default', () => {
    const headers = { 'cf-connecting-ip': '192.0.2.44', 'x-real-ip': real }
    expect(getClientIp(request(headers))).toBe(real)
  })

  it('reads only the configured header when set', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'CF-Connecting-IP')
    const headers = {
      'cf-connecting-ip': '192.0.2.44',
      'x-real-ip': real,
      'x-forwarded-for': '198.51.100.7',
    }
    expect(getClientIp(request(headers))).toBe('192.0.2.44')
    expect(requestIp(new Headers(headers))).toBe('192.0.2.44')
    expect(loginMetadata(new Headers(headers)).ipAddress).toBe('192.0.2.44')
  })

  it('does not fall back to other headers when the configured one is missing or invalid', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'cf-connecting-ip')
    const missing = { 'x-real-ip': real, 'x-forwarded-for': '198.51.100.7' }
    expect(getClientIp(request(missing))).toBe('127.0.0.1')
    expect(requestIp(new Headers(missing))).toBe('unknown')
    expect(loginMetadata(new Headers(missing)).ipAddress).toBeNull()
    const invalid = { ...missing, 'cf-connecting-ip': 'not-an-ip' }
    expect(getClientIp(request(invalid))).toBe('127.0.0.1')
  })

  it('uses the first entry of a configured list header', () => {
    vi.stubEnv('FLARE_CLIENT_IP_HEADER', 'X-Forwarded-For')
    expect(
      getClientIp(
        request({
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
        getClientIp(
          request({ 'x-real-ip': real, 'x-forwarded-for': '198.51.100.7' })
        )
      ).toBe(real)
    }
  })
})
