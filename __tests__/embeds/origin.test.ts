import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestOrigin } from '@/lib/embeds/origin'

const origin = (headers: Record<string, string>) =>
  requestOrigin(new Headers(headers))

afterEach(() => vi.unstubAllEnvs())

describe('the address a preview links back to', () => {
  it('is the configured public address when the request names its host', () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://files.lan:3000/')
    vi.stubEnv('NODE_ENV', 'production')
    // An HTTP-only instance keeps its scheme, where production once meant HTTPS.
    expect(origin({ host: 'files.lan:3000' })).toBe('http://files.lan:3000')
    expect(origin({})).toBe('http://files.lan:3000')
  })

  it('recognizes its own host when a proxy forwards it', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    expect(
      origin({ host: 'flare:3000', 'x-forwarded-host': 'flare.example' })
    ).toBe('https://flare.example')
  })

  it('never repeats a forwarded host, which any client can send', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      origin({ host: 'flare.example', 'x-forwarded-host': 'evil.example' })
    ).toBe('https://flare.example')
    expect(
      origin({ host: 'i.example.org', 'x-forwarded-host': 'evil.example' })
    ).toBe('https://i.example.org')
  })

  it('uses another domain as requested, over HTTPS in production', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    vi.stubEnv('NODE_ENV', 'production')
    expect(origin({ host: 'i.example.org' })).toBe('https://i.example.org')
    vi.stubEnv('NODE_ENV', 'development')
    expect(origin({ host: 'localhost:3000' })).toBe('http://localhost:3000')
  })

  it('never builds an address from a host that is not one', () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(origin({ host: 'bad host/"><script>' })).toBe(
      'http://localhost:3000'
    )
  })
})
