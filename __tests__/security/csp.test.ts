import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'
import { beforeAll, describe, expect, it } from 'vitest'

import { headElements, withScriptNonce } from '@/lib/customization/custom-code'
import { handleBotRequest } from '@/lib/middleware/bot-handler'
import {
  CSP_HEADER,
  NONCE_HEADER,
  contentSecurityPolicy,
  newNonce,
} from '@/lib/security/csp'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'csp-test-secret-0123456789abcdef0123'
})

const directives = (policy: string) =>
  new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ')
      return [name, values] as const
    })
  )

describe('Content-Security-Policy (section 13, requirement 1)', () => {
  const nonce = 'dGVzdC1ub25jZS0xMjM0NTY='
  const policy = directives(contentSecurityPolicy(nonce))

  it('runs scripts only with the nonce, and WebAssembly without eval of text', () => {
    expect(policy.get('script-src')).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
    ])
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'")
    expect(policy.get('script-src')).not.toContain("'unsafe-eval'")
    expect(policy.has('script-src-elem')).toBe(false)
    expect(policy.has('script-src-attr')).toBe(false)
  })

  it('allows eval only in development, where React needs it', () => {
    expect(
      directives(contentSecurityPolicy(nonce, { development: true })).get(
        'script-src'
      )
    ).toContain("'unsafe-eval'")
  })

  it('closes plug-ins, base addresses and framing by other sites', () => {
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('frame-ancestors')).toEqual(["'self'"])
    expect(policy.get('default-src')).toEqual(["'self'"])
  })

  it('lets the viewers of decrypted files use blob: and data: where they need them', () => {
    expect(policy.get('img-src')).toEqual(
      expect.arrayContaining(["'self'", 'data:', 'blob:'])
    )
    expect(policy.get('media-src')).toEqual(
      expect.arrayContaining(["'self'", 'blob:'])
    )
    expect(policy.get('frame-src')).toEqual(["'self'", 'blob:'])
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:'])
    // No script may come from a blob: or data: address.
    for (const scheme of ['blob:', 'data:', 'https:', 'http:', '*'])
      expect(policy.get('script-src')).not.toContain(scheme)
  })

  it('refuses a value that is not a nonce, which could add a directive', () => {
    for (const bad of [
      '',
      'short',
      "x' 'unsafe-inline",
      'a; script-src *',
      'has space here1234',
    ])
      expect(() => contentSecurityPolicy(bad), bad).toThrow()
  })

  it('makes a new nonce of 128 bits each time', () => {
    const seen = new Set(Array.from({ length: 200 }, newNonce))
    expect(seen.size).toBe(200)
    for (const value of seen) {
      expect(value).toMatch(/^[A-Za-z0-9+/]{22}==$/)
      expect(() => contentSecurityPolicy(value)).not.toThrow()
    }
  })
})

describe('the proxy sends the policy with every page', () => {
  const page = (path: string, headers: Record<string, string> = {}) =>
    proxy(
      new NextRequest(new URL(path, 'http://localhost:3000'), {
        headers: { 'user-agent': 'Mozilla/5.0 Firefox/131.0', ...headers },
      })
    )

  it('puts the same nonce in the response policy and in the request Next.js renders from', async () => {
    const response = await page('/auth/login')
    const policy = response.headers.get(CSP_HEADER)!
    const nonce = /'nonce-([^']+)'/.exec(policy)![1]
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(
      nonce
    )
    expect(
      response.headers.get('x-middleware-request-content-security-policy')
    ).toBe(policy)
  })

  it('uses a different nonce for every response and ignores one a client sends', async () => {
    const sent = 'YXR0YWNrZXItY2hvc2VuLW5vbmNl'
    const first = await page('/abc12/readme', { [NONCE_HEADER]: sent })
    const second = await page('/abc12/readme', { [NONCE_HEADER]: sent })
    const nonceOf = (response: Response) =>
      response.headers.get(`x-middleware-request-${NONCE_HEADER}`)
    expect(nonceOf(first)).not.toBe(sent)
    expect(nonceOf(first)).not.toBe(nonceOf(second))
    expect(first.headers.get(CSP_HEADER)).not.toContain(sent)
  })

  it('leaves raw file bytes to their own sandbox policy', async () => {
    const response = await page('/abc12/photo.png/raw')
    expect(response.headers.get(CSP_HEADER)).toBeNull()
  })
})

describe('Custom head scripts get the nonce (section 13.1)', () => {
  it('adds it to every script element and to nothing else', () => {
    const elements = headElements(
      '<script>track()</script><script src="https://cdn.example/a.js" async></script><meta name="x" content="y"><style>a{}</style><link rel="preconnect" href="https://cdn.example">'
    ).map((element) => withScriptNonce(element, 'bm9uY2U='))
    expect(elements.map(({ tag, props }) => [tag, props.nonce])).toEqual([
      ['script', 'bm9uY2U='],
      ['script', 'bm9uY2U='],
      ['meta', undefined],
      ['style', undefined],
      ['link', undefined],
    ])
    expect(elements[1].props.src).toBe('https://cdn.example/a.js')
  })

  it('replaces a nonce typed into the setting, and removes it when there is none', () => {
    const [typed] = headElements('<script nonce="guessed">x()</script>')
    expect(withScriptNonce(typed, 'cmVhbA==').props.nonce).toBe('cmVhbA==')
    expect('nonce' in withScriptNonce(typed, null).props).toBe(false)
  })
})

describe('crawlers and encrypted files (section 11.3)', () => {
  const crawl = (path: string) =>
    handleBotRequest(
      new NextRequest(new URL(path, 'http://localhost:3000'), {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' },
      })
    )

  it('does not redirect a crawler to the raw content of an encrypted file', () => {
    const response = crawl('/abc12/e_0123456789abcdefghijkl')
    expect(response?.headers.get('location')).toBeNull()
    expect(response?.headers.get('x-middleware-next')).toBe('1')
  })

  it('still redirects a crawler to the raw content of a plain file', () => {
    for (const path of [
      '/abc12/photo.png',
      '/abc12/readme',
      '/abc12/a1b2c3.png',
    ])
      expect(
        new URL(crawl(path)!.headers.get('location')!).pathname,
        path
      ).toBe(`${path}/raw`)
    // A video keeps its page, as before.
    expect(crawl('/abc12/clip.mp4')?.headers.get('location')).toBeNull()
  })
})
