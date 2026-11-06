import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/lib/http/errors'
import {
  assertJsonMutation,
  assertMediaType,
  assertSameOrigin,
} from '@/lib/http/request'
import { isSameOriginRequest } from '@/lib/security/request-origin'

const publicOrigin = 'https://preview-flare.up.railway.app'
const internalUrl = 'http://preview-app.railway.internal:3000/api/customization'
const request = (headers: Record<string, string> = {}) =>
  new Request(internalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  })

/** The refusal's status, or null when the request may proceed. */
function refusal(check: () => void) {
  try {
    check()
    return null
  } catch (error) {
    return (error as HttpError).status
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('proxied browser request origins', () => {
  it('accepts the configured public HTTPS origin through an internal HTTP hop', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    const proxied = request({
      Origin: publicOrigin,
      'Sec-Fetch-Site': 'same-origin',
    })
    expect(isSameOriginRequest(proxied)).toBe(true)
    expect(refusal(() => assertJsonMutation(proxied))).toBeNull()
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
    expect(refusal(() => assertJsonMutation(request({ Origin: origin })))).toBe(
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
      refusal(() =>
        assertJsonMutation(
          request({ Origin: publicOrigin, 'Content-Type': 'text/plain' })
        )
      )
    ).toBe(415)
    const upload = request({
      Origin: publicOrigin,
      'Content-Type': 'multipart/form-data; boundary=fixture',
    })
    expect(
      refusal(() => {
        assertSameOrigin(upload)
        assertMediaType(upload, 'multipart/form-data')
      })
    ).toBeNull()
  })
})
