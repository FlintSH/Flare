import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/lib/http/errors'
import { assertBrowserWrite, readForm, readJson } from '@/lib/http/request'
import { publicOrigin as configuredOrigin } from '@/lib/security/public-origin'
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
    expect(refusal(() => assertBrowserWrite(proxied))).toBeNull()
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
    expect(refusal(() => assertBrowserWrite(request({ Origin: origin })))).toBe(
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

  it('checks writes only: reads from other origins are not refused', () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect(
        refusal(() =>
          assertBrowserWrite(
            new Request(internalUrl, {
              method,
              headers: { Origin: 'https://attacker.example' },
            })
          )
        )
      ).toBeNull()
  })

  it('makes a browser write send JSON or a multipart form, as its reader expects', async () => {
    vi.stubEnv('NEXTAUTH_URL', publicOrigin)
    const write = (contentType: string, body: BodyInit = '{}') => {
      const write = new Request(internalUrl, {
        method: 'POST',
        headers: { Origin: publicOrigin, 'Content-Type': contentType },
        body,
      })
      assertBrowserWrite(write)
      return write
    }
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=fixture',
    ])
      await expect(readJson(write(type))).rejects.toMatchObject({
        status: 415,
        message: 'Use application/json.',
      })
    expect(await readJson(write('application/json; charset=utf-8'))).toEqual({})
    await expect(
      readForm(write('application/x-www-form-urlencoded', 'a=b'), {
        limit: 1024,
      })
    ).rejects.toMatchObject({
      status: 415,
      message: 'Use multipart/form-data.',
    })
    const form = new FormData()
    form.set('name', 'value')
    const upload = new Request(internalUrl, {
      method: 'POST',
      headers: { Origin: publicOrigin },
      body: form,
    })
    assertBrowserWrite(upload)
    expect((await readForm(upload, { limit: 1024 })).get('name')).toBe('value')
  })

  it('leaves the body type of requests no session authenticated to the route', async () => {
    const tokenRequest = new Request(internalUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer flr_token',
        'Content-Type': 'text/plain',
      },
      body: '{"url":"https://example.com"}',
    })
    expect(await readJson(tokenRequest)).toEqual({ url: 'https://example.com' })
  })
})

describe('the public origin', () => {
  it.each([
    ['https://files.example.com', 'https://files.example.com'],
    ['https://files.example.com/base/', 'https://files.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('reads %s as an http(s) URL', (configured, origin) => {
    expect(configuredOrigin({ NEXTAUTH_URL: configured })?.origin).toBe(origin)
  })

  it.each([
    undefined,
    '',
    'files.example.com',
    'ftp://files.example.com',
    'https://user:secret@files.example.com',
  ])('has none when NEXTAUTH_URL is %s', (configured) => {
    expect(configuredOrigin({ NEXTAUTH_URL: configured })).toBeNull()
  })
})
