import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CORS_ENV,
  applyCors,
  corsWarnings,
  preflight,
  readCorsPolicy,
} from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { requiredApiScope } from '@/lib/integrations/bearer-routes'
import { loggers } from '@/lib/logger'

vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  auditRequest: (
    _request: Request,
    _options: unknown,
    handle: () => Promise<Response>
  ) => handle(),
}))

const APP = 'https://flare.test'
const SITE = 'https://app.example.com'

function request(
  path: string,
  init: RequestInit & { origin?: string | null } = {}
) {
  const { origin = SITE, ...rest } = init
  const headers = new Headers(rest.headers)
  if (origin) headers.set('Origin', origin)
  return new Request(APP + path, { ...rest, headers })
}

function preflightRequest(path: string, method: string, origin = SITE) {
  return request(path, {
    method: 'OPTIONS',
    origin,
    headers: {
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('reading FLARE_CORS_ORIGINS', () => {
  it('is off when unset or empty', () => {
    expect(readCorsPolicy(undefined).policy).toBeNull()
    expect(readCorsPolicy('  ').policy).toBeNull()
  })

  it('reads * as every origin', () => {
    expect(readCorsPolicy('*').policy).toEqual({ any: true })
    expect(readCorsPolicy('https://a.example, *').policy).toEqual({
      any: true,
    })
  })

  it('normalizes origins separated by commas or whitespace', () => {
    const { policy, invalid } = readCorsPolicy(
      'https://App.Example.com/, http://localhost:5173\nhttps://b.example:443'
    )
    expect(invalid).toEqual([])
    expect(policy).toEqual({
      any: false,
      origins: new Set([
        'https://app.example.com',
        'http://localhost:5173',
        'https://b.example',
      ]),
    })
  })

  it('ignores and reports entries that are not origins', () => {
    const value =
      'app.example.com https://a.example/path ftp://b.example https://u:p@c.example null https://ok.example'
    const { policy, invalid } = readCorsPolicy(value)
    expect(policy).toEqual({
      any: false,
      origins: new Set(['https://ok.example']),
    })
    expect(invalid).toEqual([
      'app.example.com',
      'https://a.example/path',
      'ftp://b.example',
      'https://u:p@c.example',
      'null',
    ])
    expect(corsWarnings(value)).toHaveLength(5)
    expect(corsWarnings(value)[0]).toContain(CORS_ENV)
  })

  it('stays off when no entry is valid', () => {
    expect(readCorsPolicy('example.com').policy).toBeNull()
  })
})

describe('preflight', () => {
  const tokenPreflight = preflight('token')

  it('sends no CORS headers while FLARE_CORS_ORIGINS is unset', async () => {
    vi.stubEnv(CORS_ENV, '')
    const response = await tokenPreflight(
      preflightRequest('/api/files', 'POST')
    )
    expect(response.status).toBe(204)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('allows a listed origin to call a named-token method', async () => {
    vi.stubEnv(CORS_ENV, `${SITE} http://localhost:5173`)
    const response = await tokenPreflight(
      preflightRequest('/api/files', 'POST')
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST'
    )
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'Authorization'
    )
    // A web app with a token can send an encrypted upload.
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'X-Flare-Encrypted'
    )
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600')
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
  })

  it('answers * without Vary when every origin is allowed', async () => {
    vi.stubEnv(CORS_ENV, '*')
    const response = await tokenPreflight(
      preflightRequest('/api/urls/abc123', 'DELETE', 'https://any.example')
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('DELETE')
    expect(response.headers.has('Vary')).toBe(false)
  })

  it('refuses an origin that is not listed', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await tokenPreflight(
      preflightRequest('/api/files', 'POST', 'https://evil.example')
    )
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('refuses methods named tokens cannot call, even on a token route', async () => {
    vi.stubEnv(CORS_ENV, '*')
    for (const [path, method] of [
      ['/api/files', 'DELETE'],
      ['/api/folders', 'POST'],
      ['/api/profile', 'PUT'],
      ['/api/settings', 'GET'],
    ]) {
      const response = await tokenPreflight(preflightRequest(path, method))
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    }
  })

  it('allows only reads of file content', async () => {
    vi.stubEnv(CORS_ENV, '*')
    const filePreflight = preflight('file')
    const read = await filePreflight(
      preflightRequest('/abc/photo.png/raw', 'GET')
    )
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(read.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD')
    expect(read.headers.get('Access-Control-Allow-Headers')).toBe('Range')
    const write = await filePreflight(
      preflightRequest('/abc/photo.png/raw', 'POST')
    )
    expect(write.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
})

describe('answers to cross-origin requests', () => {
  const ok = () => Response.json({ data: [] })

  it('change nothing while FLARE_CORS_ORIGINS is unset', () => {
    vi.stubEnv(CORS_ENV, '')
    const response = applyCors(request('/api/files'), ok(), 'token')
    expect([...response.headers.keys()]).toEqual(['content-type'])
  })

  it('let a listed origin read named-token routes without credentials', () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = applyCors(request('/api/files'), ok(), 'token')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'Retry-After'
    )
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
  })

  it('keep an existing Vary header', () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = applyCors(
      request('/api/files'),
      new Response('{}', { headers: { Vary: 'Accept-Encoding' } }),
      'token'
    )
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin')
  })

  it('vary on Origin even for same-site requests, which send none', () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = applyCors(
      request('/api/files', { origin: null }),
      ok(),
      'token'
    )
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('leave session-only routes and methods alone', () => {
    vi.stubEnv(CORS_ENV, '*')
    for (const [path, method] of [
      ['/api/profile', 'PUT'],
      ['/api/files/abc123', 'DELETE'],
      ['/api/users', 'GET'],
    ]) {
      const response = applyCors(request(path, { method }), ok(), 'token')
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
      expect(response.headers.has('Vary')).toBe(false)
    }
  })

  it('expose range headers on file content', () => {
    vi.stubEnv(CORS_ENV, '*')
    const response = applyCors(
      request('/abc/clip.mp4/raw'),
      new Response('x', { status: 206 }),
      'file'
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'Accept-Ranges, Content-Disposition, Content-Range, Retry-After'
    )
  })

  it('pass a response with immutable headers through unchanged', () => {
    vi.stubEnv(CORS_ENV, '*')
    const redirect = Response.redirect('https://storage.example/object', 302)
    expect(applyCors(request('/api/files'), redirect, 'token')).toBe(redirect)
  })

  it('reach errors the route kernel answers too', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const handler = routes('/api/urls', { failure: { message: 'Failed.' } })(
      async () => {
        throw new Error('boom')
      }
    )
    vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    const response = await handler(request('/api/urls', { method: 'POST' }))
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
  })
})

describe('route files', () => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return routeFiles(path)
      return name === 'route.ts' ? [path] : []
    })
  }

  it('answer preflights exactly where a named token can call a method', () => {
    const root = join(process.cwd(), 'app/api')
    for (const file of routeFiles(root)) {
      const path =
        '/api/' +
        relative(root, file)
          .replace(/\/?route\.ts$/, '')
          .replace(/\[partNumber\]/g, '1')
          .replace(/\[[^\]]+\]/g, 'example-id')
      const source = readFileSync(file, 'utf8')
      const exported = METHODS.filter((method) =>
        new RegExp(
          `export\\s+(?:const|async\\s+function)\\s+${method}\\b`
        ).test(source)
      )
      const tokenRoute = exported.some(
        (method) => requiredApiScope(method, path.replace(/\/$/, '')) !== null
      )
      expect(
        /export const OPTIONS = preflight\('token'\)/.test(source),
        `${relative(process.cwd(), file)} OPTIONS`
      ).toBe(tokenRoute)
    }
  })
})

describe('file content routes', () => {
  it('answer preflights and let FLARE_CORS_ORIGINS reach their reads', () => {
    for (const file of [
      'app/(raw)/[userUrlId]/[filename]/raw/route.ts',
      'app/(raw)/[userUrlId]/[filename]/direct/route.ts',
      'app/api/files/[...path]/route.ts',
      'app/api/files/[id]/download/route.ts',
      'app/api/files/[id]/thumbnail/route.ts',
      'app/api/files/[id]/ocr/route.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, file).toContain("cors: 'file'")
      expect(source, file).toContain("export const OPTIONS = preflight('file')")
    }
  })
})
