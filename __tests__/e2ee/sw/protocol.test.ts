import { describe, expect, it } from 'vitest'

import {
  LOCAL_ADDRESS_PREFIX,
  guardHeaders,
  isLocalToken,
  localAddressPath,
  localAddressToken,
  localAnswer,
  localContentType,
  requestAllowed,
  unsatisfiableHeaders,
} from '@/lib/e2ee/sw/protocol'
import { safeRendering } from '@/lib/files/safe-render'
import { PUBLIC_ID_PATTERN } from '@/lib/users/public-id'

const TOKEN = 'A'.repeat(43)

describe('the form of a local address', () => {
  it('is a path that no file page can have', () => {
    expect(LOCAL_ADDRESS_PREFIX).toBe('/_flare/local/')
    // The first segment of a file page is a URL ID or a vanity ID.
    expect(new RegExp(`^${PUBLIC_ID_PATTERN}$`).test('_flare')).toBe(false)
  })

  it('reads the token and tells its own paths from all others', () => {
    expect(localAddressToken(localAddressPath(TOKEN))).toBe(TOKEN)
    for (const path of [
      '/',
      '/dashboard',
      '/api/files/alexm/e_x',
      '/_next/static/chunks/a.js',
      '/_flare',
      '/_flare/other/x',
      `/alexm${LOCAL_ADDRESS_PREFIX}${TOKEN}`,
    ])
      expect(localAddressToken(path), path).toBeNull()
    // Under the prefix but not a token: the worker answers 404 itself.
    for (const path of [
      LOCAL_ADDRESS_PREFIX,
      `${LOCAL_ADDRESS_PREFIX}short`,
      `${LOCAL_ADDRESS_PREFIX}${TOKEN}/more`,
      `${LOCAL_ADDRESS_PREFIX}${'A'.repeat(42)}.`,
      `${LOCAL_ADDRESS_PREFIX}../api/files`,
    ])
      expect(localAddressToken(path), path).toBe('')
  })

  it('accepts only 43 base64url characters as a token', () => {
    expect(isLocalToken(TOKEN)).toBe(true)
    expect(isLocalToken('A'.repeat(42))).toBe(false)
    expect(isLocalToken('A'.repeat(44))).toBe(false)
    expect(isLocalToken(`${'A'.repeat(42)}/`)).toBe(false)
    expect(isLocalToken(null)).toBe(false)
  })
})

describe('the type a local address answers with', () => {
  it('serves the media types of the safe-render list as they are', () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/ogg',
      'audio/flac',
    ])
      expect(localContentType('media', type)).toBe(type)
  })

  it.each([
    'text/html',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'image/svg+xml',
    'text/xml',
    'application/xml',
    'application/pdf',
    'text/plain',
    'text/javascript',
    'application/javascript',
    'application/octet-stream',
    'IMAGE/PNG',
    'image/png ',
    '',
  ])('refuses %j as media', (type) => {
    expect(localContentType('media', type)).toBeNull()
  })

  it('serves only a PDF in a frame', () => {
    expect(localContentType('frame', 'application/pdf')).toBe('application/pdf')
    for (const type of ['text/html', 'image/svg+xml', 'image/png', 'video/mp4'])
      expect(localContentType('frame', type)).toBeNull()
  })

  it('forces the generic type for a download and for data, whatever is claimed', () => {
    for (const mode of ['download', 'data'] as const)
      for (const type of ['text/html', 'image/svg+xml', 'application/pdf', 7])
        expect(localContentType(mode, type)).toBe('application/octet-stream')
  })

  it('agrees with the renderer list: each type a renderer plays has an address', () => {
    for (const type of [
      'video/mp4',
      'video/quicktime',
      'audio/x-m4a',
      'image/jpg',
    ]) {
      const rendering = safeRendering({ type })
      if (rendering.renderer === 'download' || rendering.renderer === 'text')
        throw new Error(`${type} has no renderer`)
      expect(localContentType('media', rendering.blobType)).toBe(
        rendering.blobType
      )
    }
    // An SVG has a renderer, and no address: it is drawn from a data: address.
    const svg = safeRendering({ type: 'image/svg+xml' })
    expect(svg.renderer).toBe('svg')
    expect(localContentType('media', 'image/svg+xml')).toBeNull()
  })
})

describe('which request may get a resource', () => {
  const owner = 'client-1'
  const media = { mode: 'media', clientId: owner } as const
  it('gives media only to a media element of the page that registered it', () => {
    for (const destination of ['video', 'audio', 'image'])
      expect(
        requestAllowed(media, { mode: 'no-cors', destination, clientId: owner })
      ).toBe(true)
    // Another page of the same origin.
    expect(
      requestAllowed(media, {
        mode: 'no-cors',
        destination: 'video',
        clientId: 'client-2',
      })
    ).toBe(false)
    // A navigation: the address typed, opened in a tab, or put in a frame.
    for (const destination of [
      'document',
      'iframe',
      'frame',
      'embed',
      'object',
    ])
      expect(
        requestAllowed(media, { mode: 'navigate', destination, clientId: '' })
      ).toBe(false)
    // Script, a worker, a style sheet: nothing but a media element.
    for (const destination of [
      '',
      'script',
      'worker',
      'style',
      'embed',
      'object',
    ])
      expect(
        requestAllowed(media, { mode: 'cors', destination, clientId: owner })
      ).toBe(false)
  })

  it('gives data only to a fetch of the page that registered it', () => {
    const data = { mode: 'data', clientId: owner } as const
    expect(
      requestAllowed(data, {
        mode: 'same-origin',
        destination: '',
        clientId: owner,
      })
    ).toBe(true)
    expect(
      requestAllowed(data, {
        mode: 'same-origin',
        destination: '',
        clientId: 'x',
      })
    ).toBe(false)
    expect(
      requestAllowed(data, {
        mode: 'navigate',
        destination: 'document',
        clientId: '',
      })
    ).toBe(false)
    expect(
      requestAllowed(data, {
        mode: 'no-cors',
        destination: 'script',
        clientId: owner,
      })
    ).toBe(false)
  })

  it('gives a download and a frame only to a navigation', () => {
    for (const mode of ['download', 'frame'] as const) {
      const resource = { mode, clientId: owner }
      expect(
        requestAllowed(resource, {
          mode: 'navigate',
          destination: 'iframe',
          clientId: '',
        })
      ).toBe(true)
      expect(
        requestAllowed(resource, {
          mode: 'no-cors',
          destination: 'video',
          clientId: owner,
        })
      ).toBe(false)
      expect(
        requestAllowed(resource, {
          mode: 'cors',
          destination: '',
          clientId: owner,
        })
      ).toBe(false)
    }
    expect(
      requestAllowed(
        { mode: 'frame', clientId: owner },
        { mode: 'navigate', destination: 'document', clientId: '' }
      )
    ).toBe(false)
    expect(
      requestAllowed(
        { mode: 'download', clientId: owner },
        { mode: 'navigate', destination: 'document', clientId: '' }
      )
    ).toBe(true)
  })
})

describe('the headers of an answer', () => {
  it('guards every answer against being read as a page', () => {
    expect(guardHeaders()).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    })
  })

  it('answers a range with 206 and the exact Content-Range', () => {
    const answer = localAnswer({
      mode: 'media',
      contentType: 'video/mp4',
      length: 1000,
      start: 100,
      end: 300,
      ranged: true,
    })
    expect(answer.status).toBe(206)
    expect(answer.headers).toMatchObject({
      ...guardHeaders(),
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'inline',
      'Content-Length': '200',
      'Content-Range': 'bytes 100-299/1000',
      'Accept-Ranges': 'bytes',
    })
  })

  it('answers a request without a range with 200 and the whole length', () => {
    const answer = localAnswer({
      mode: 'media',
      contentType: 'audio/mpeg',
      length: 1000,
      start: 0,
      end: 1000,
      ranged: false,
    })
    expect(answer.status).toBe(200)
    expect(answer.headers['Content-Length']).toBe('1000')
    expect(answer.headers['Content-Range']).toBeUndefined()
    expect(answer.headers['Accept-Ranges']).toBe('bytes')
  })

  it('makes a download an attachment of the generic type with a cleaned name', () => {
    const { headers } = localAnswer({
      mode: 'download',
      contentType: 'text/html',
      filename: '../../evil<script>‮gpj.html',
      length: 10,
      start: 0,
      end: 10,
      ranged: false,
    })
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="evil_script_gpj.html"; filename*=UTF-8''evil_script_gpj.html`
    )
    expect(headers['Accept-Ranges']).toBeUndefined()
    expect(headers['Content-Security-Policy']).toBe(
      "sandbox; default-src 'none'"
    )
  })

  it('encodes a name outside ASCII and never breaks out of the header', () => {
    const { headers } = localAnswer({
      mode: 'download',
      contentType: 'x',
      filename: 'été "q"\r\nX-Injected: 1.txt',
      length: 1,
      start: 0,
      end: 1,
      ranged: false,
    })
    const value = headers['Content-Disposition']
    expect(value).not.toMatch(/[\r\n]/)
    expect(value.startsWith('attachment; filename="')).toBe(true)
    expect(value).toContain("filename*=UTF-8''%C3%A9t%C3%A9")
    expect(value.split('"')).toHaveLength(3)
  })

  it('gives a frame the PDF type, inline, and no ranges', () => {
    const { status, headers } = localAnswer({
      mode: 'frame',
      contentType: 'application/pdf',
      length: 500,
      start: 0,
      end: 500,
      ranged: false,
    })
    expect(status).toBe(200)
    expect(headers['Content-Type']).toBe('application/pdf')
    expect(headers['Content-Disposition']).toBe('inline')
    expect(headers['Accept-Ranges']).toBeUndefined()
  })

  it('refuses to build an answer for a type the mode does not serve', () => {
    for (const [mode, contentType] of [
      ['media', 'text/html'],
      ['media', 'image/svg+xml'],
      ['frame', 'text/html'],
    ] as const)
      expect(() =>
        localAnswer({
          mode,
          contentType,
          length: 1,
          start: 0,
          end: 1,
          ranged: false,
        })
      ).toThrow()
  })

  it('answers a range outside the resource with its length', () => {
    expect(unsatisfiableHeaders(1234)).toMatchObject({
      ...guardHeaders(),
      'Content-Range': 'bytes */1234',
    })
  })
})
