import { afterEach, describe, expect, it, vi } from 'vitest'

import { appearanceMutationGuard } from '@/lib/customization/http'
import { isSameOriginRequest } from '@/lib/security/request-origin'

const publicOrigin = 'https://preview-flare.up.railway.app'
const internalUrl = 'http://preview-app.railway.internal:3000/api/customization'
const request = (headers: Record<string, string> = {}) =>
  new Request(internalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  })

afterEach(() => vi.unstubAllEnvs())

describe('proxied browser request origins', () => {
  it('accepts the configured public HTTPS origin through an internal HTTP hop', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    const proxied = request({
      Origin: publicOrigin,
      'Sec-Fetch-Site': 'same-origin',
    })
    expect(isSameOriginRequest(proxied)).toBe(true)
    expect(appearanceMutationGuard(proxied)).toBeNull()
  })

  it('normalizes the configured origin without trusting an arbitrary path in Origin', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin + '/api/auth')
    expect(isSameOriginRequest(request({ Origin: publicOrigin }))).toBe(true)
    expect(
      isSameOriginRequest(request({ Origin: publicOrigin + '/api/auth' }))
    ).toBe(false)
  })

  it('keeps direct and non-browser requests working', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    expect(
      isSameOriginRequest(request({ Origin: new URL(internalUrl).origin }))
    ).toBe(true)
    expect(isSameOriginRequest(request())).toBe(true)
  })

  it.each([
    'https://attacker.example',
    'https://preview-flare.up.railway.app.attacker.example',
    'http://preview-flare.up.railway.app',
    publicOrigin + ':8443',
    'null',
  ])('rejects an unrelated origin: %s', (origin) => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    expect(appearanceMutationGuard(request({ Origin: origin }))?.status).toBe(
      403
    )
  })

  it('does not trust spoofed proxy headers', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    expect(
      isSameOriginRequest(
        request({
          Origin: 'https://attacker.example',
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
          'X-Forwarded-Proto': 'https',
          Forwarded: 'host=attacker.example;proto=https',
        })
      )
    ).toBe(false)
  })

  it.each([publicOrigin, undefined])(
    'rejects cross-site fetches even with a permitted or absent origin: %s',
    (origin) => {
      vi.stubEnv('NEXTAUTH_URL', publicOrigin)
      expect(
        isSameOriginRequest(
          request({
            ...(origin ? { Origin: origin } : {}),
            'Sec-Fetch-Site': 'cross-site',
          })
        )
      ).toBe(false)
    }
  )

  it.each([
    '',
    'not a URL',
    'file:///tmp/flare',
    'https://user:secret@preview-flare.up.railway.app',
  ])('fails closed for an invalid configured public URL: %s', (configured) => {
    vi.stubEnv('NEXTAUTH_URL', configured)
    expect(isSameOriginRequest(request({ Origin: publicOrigin }))).toBe(false)
    expect(
      isSameOriginRequest(request({ Origin: new URL(internalUrl).origin }))
    ).toBe(true)
  })

  it('retains JSON and image content-type checks for allowed proxy requests', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    expect(
      appearanceMutationGuard(
        request({ Origin: publicOrigin, 'Content-Type': 'text/plain' })
      )?.status
    ).toBe(415)
    expect(
      appearanceMutationGuard(
        request({
          Origin: publicOrigin,
          'Content-Type': 'multipart/form-data; boundary=fixture',
        }),
        'image'
      )
    ).toBeNull()
  })
})
