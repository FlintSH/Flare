const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')
const { createGateway, MAX_BODY } = require('./gateway.cjs')

const ORIGIN = 'https://flare-test.up.railway.app'
const ACK = { cookie: 'flare_preview_ack=1' }
const env = () => ({
  PREVIEW_UPSTREAM: 'http://preview-app.railway.internal:3000',
  PREVIEW_PUBLIC_URL: ORIGIN,
  PREVIEW_EXPIRES_AT: String(Math.floor(Date.now() / 1000) + 3600),
})

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

async function fixture(t, handler, options = {}) {
  const calls = []
  const upstream = http.createServer((req, res) => {
    calls.push({ path: req.url, headers: req.headers, method: req.method })
    if (handler) return handler(req, res)
    req.resume()
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ path: req.url }))
    })
  })
  const upstreamURL = await listen(upstream)
  const gateway = createGateway(env(), {
    ...options,
    upstreamForTests: upstreamURL,
  })
  const url = await listen(gateway)
  t.after(async () => {
    await Promise.all(
      [gateway, upstream].map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve)
            server.closeAllConnections()
          })
      )
    )
  })
  return { url, calls }
}

function request(base, path = '/', options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base, { path, ...options }, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body })
      )
      res.on('error', reject)
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

test('production configuration accepts only the fixed private target and Railway HTTPS origin', () => {
  const gateway = createGateway(env())
  assert.equal(gateway.maxConnections, 128)
  assert.equal(gateway.maxRequestsPerSocket, 100)
  for (const invalid of [
    { PREVIEW_UPSTREAM: 'http://169.254.169.254' },
    { PREVIEW_UPSTREAM: 'http://other.railway.internal:3000' },
    { PREVIEW_PUBLIC_URL: 'https://production.example.com' },
    { PREVIEW_PUBLIC_URL: 'https://example.up.railway.app.evil.test' },
    { PREVIEW_PUBLIC_URL: `${ORIGIN}/path` },
    { PREVIEW_PUBLIC_URL: 'https://user:password@flare-test.up.railway.app' },
    { PREVIEW_EXPIRES_AT: 'Infinity' },
  ])
    assert.throws(() => createGateway({ ...env(), ...invalid }))
})

test('notice and acknowledgment precede access without calling the app', async (t) => {
  const { url, calls } = await fixture(t)
  const redirect = await request(url)
  assert.equal(redirect.status, 303)
  assert.equal(redirect.headers.location, '/_preview')
  const notice = await request(url, '/_preview')
  assert.equal(notice.status, 200)
  assert.match(notice.body, /unreviewed pull request code/)
  assert.match(notice.body, /Flare’s normal setup/)
  assert.doesNotMatch(
    notice.body,
    /Demo login|demo@example\.test|Flare-preview-only|settings and integrations are disabled/
  )
  assert.match(notice.body, /<form method="post" action="\/_preview\/enter">/)
  assert.equal(notice.headers['x-robots-tag'], 'noindex, nofollow, noarchive')
  // Navigation form POSTs from no-referrer documents send Origin:null.
  assert.equal(notice.headers['referrer-policy'], 'same-origin')
  assert.equal(
    (await request(url, '/_preview/enter', { method: 'POST' })).status,
    403
  )
  for (const origin of ['null', 'https://unrelated.example.test']) {
    const rejected = await request(url, '/_preview/enter', {
      method: 'POST',
      headers: { origin },
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.headers['set-cookie'], undefined)
  }
  const enter = await request(url, '/_preview/enter', {
    method: 'POST',
    headers: { origin: ORIGIN },
  })
  assert.equal(enter.status, 303)
  assert.match(enter.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/)
  assert.equal(calls.length, 0)
  const opened = await request(url, enter.headers.location, {
    headers: { cookie: enter.headers['set-cookie'][0].split(';')[0] },
  })
  assert.equal(opened.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(opened.headers['referrer-policy'], undefined)
})

test('native multipart uploads preserve their token, profile and file without a preview cookie', async (t) => {
  const boundary = 'flare-test-upload-boundary'
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="screenshot.png"',
    'Content-Type: image/png',
    '',
    'test screenshot contents',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  let uploaded = ''
  const result = { data: { url: `${ORIGIN}/f/test-screenshot.png` } }
  const { url, calls } = await fixture(t, (req, res) => {
    req.on('data', (chunk) => {
      uploaded += chunk
    })
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    })
  })
  const response = await request(url, '/api/files', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-upload-token',
      'x-upload-profile': 'test-profile',
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': Buffer.byteLength(body),
    },
    body,
  })
  assert.equal(response.status, 201)
  assert.deepEqual(JSON.parse(response.body), result)
  assert.equal(response.headers.location, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.authorization, 'Bearer test-upload-token')
  assert.equal(calls[0].headers['x-upload-profile'], 'test-profile')
  assert.equal(calls[0].headers.cookie, undefined)
  assert.equal(
    calls[0].headers['content-type'],
    `multipart/form-data; boundary=${boundary}`
  )
  assert.equal(uploaded, body)
})

test('Flare receives API requests with missing or invalid credentials and returns its own auth errors', async (t) => {
  const error = { success: false, error: 'Invalid upload token' }
  const { url, calls } = await fixture(t, (req, res) => {
    req.resume()
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer',
    })
    res.end(JSON.stringify(error))
  })
  for (const headers of [{}, { authorization: 'Bearer invalid-test-token' }]) {
    const response = await request(url, '/api/files', {
      method: 'POST',
      headers,
    })
    assert.equal(response.status, 401)
    assert.deepEqual(JSON.parse(response.body), error)
    assert.equal(response.headers['www-authenticate'], 'Bearer')
    assert.equal(response.headers.location, undefined)
  }
  assert.equal(calls.length, 2)
  assert.equal(calls[0].headers.authorization, undefined)
  assert.equal(calls[1].headers.authorization, 'Bearer invalid-test-token')
})

test('API clients, fetch requests and preflights work without acknowledgment', async (t) => {
  const { url, calls } = await fixture(t)
  const requests = [
    { path: '/api' },
    { path: '/api/' },
    { path: '/api/files?limit=2', headers: { accept: '*/*' } },
    { path: '/api/health', headers: { accept: 'application/json' } },
    {
      path: '/api/files',
      headers: {
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        accept: 'application/json, text/plain, */*',
      },
    },
    ...['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
      path: '/api/files',
      method,
    })),
    {
      path: '/api/files',
      method: 'OPTIONS',
      headers: {
        origin: 'https://api-client.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    },
  ]
  for (const { path, ...options } of requests) {
    const response = await request(url, path, options)
    assert.equal(response.status, 200, JSON.stringify({ path, ...options }))
    assert.equal(response.headers.location, undefined)
  }
  assert.equal(calls.length, requests.length)
  assert.equal(calls.at(-1).headers['access-control-request-method'], 'POST')
  assert.equal(
    calls.at(-1).headers['access-control-request-headers'],
    'authorization,content-type'
  )
})

test('API clients that explicitly reject HTML preserve their headers without acknowledgment', async (t) => {
  const { url, calls } = await fixture(t)
  const accepts = [
    ...['text/html', 'application/xhtml+xml'].flatMap((type) =>
      ['0', '0.', '0.0', '0.000'].map((quality) => `${type};q=${quality}`)
    ),
    'application/json, text/html;q=0, application/xhtml+xml;q=0.000, */*;q=0.8',
    'application/json, TEXT/HTML; charset=utf-8; Q = 0.0',
    'APPLICATION/XHTML+XML; charset=utf-8; Q=0.000, application/json',
    'text/html; profile="a,b;c;q=1";q=0',
    'application/json; profile="text/html;q=1", application/xhtml+xml;q=0',
  ]
  for (const accept of accepts) {
    const response = await request(url, '/api/files', {
      method: 'POST',
      headers: {
        accept,
        authorization: 'Bearer test-upload-token',
        'x-upload-profile': 'test-profile',
      },
    })
    assert.equal(response.status, 200, accept)
    assert.equal(response.headers.location, undefined)
    assert.equal(calls.at(-1).headers.accept, accept)
    assert.equal(calls.at(-1).headers.authorization, 'Bearer test-upload-token')
    assert.equal(calls.at(-1).headers['x-upload-profile'], 'test-profile')
    assert.equal(calls.at(-1).headers.cookie, undefined)
  }
  assert.equal(calls.length, accepts.length)
})

test('escaped quotes and backslashes keep media parameters separate from HTML weights', async (t) => {
  const { url, calls } = await fixture(t)
  const cases = [
    {
      accept: String.raw`text/html; profile="escaped \" quote, application/xhtml+xml;q=1";q=0`,
      status: 200,
    },
    {
      accept: String.raw`text/html; profile="escaped \\ backslash, application/xhtml+xml;q=1";q=0`,
      status: 200,
    },
    {
      accept: String.raw`application/json; profile="escaped \" quote; text/html;q=1", text/html;q=0`,
      status: 200,
    },
    {
      accept: String.raw`application/json; profile="ends with \\", text/html`,
      status: 303,
    },
    {
      accept: String.raw`text/html; profile="contains \";q=0"`,
      status: 303,
    },
  ]
  for (const { accept, status } of cases) {
    const response = await request(url, '/api/files', { headers: { accept } })
    assert.equal(response.status, status, accept)
    if (status === 200) assert.equal(calls.at(-1).headers.accept, accept)
    else assert.equal(response.headers.location, '/_preview')
  }
  assert.equal(calls.length, 3)
})

test('long escaped media parameters preserve valid requests and gate unterminated quotes', async (t) => {
  const { url, calls } = await fixture(t)
  // Keep headers below Node's limit while exercising many potential quote starts.
  const valid = `text/html; profile="${String.raw`\"\\`.repeat(1500)}";q=0`
  const response = await request(url, '/api/files', {
    headers: { accept: valid },
  })
  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.accept, valid)
  for (const accept of [
    `application/json; profile="${String.raw`\"`.repeat(3500)}`,
    `text/html;q=0; profile="${'\\'.repeat(7001)}`,
  ]) {
    const rejected = await request(url, '/api/files', { headers: { accept } })
    assert.equal(rejected.status, 303)
    assert.equal(rejected.headers.location, '/_preview')
  }
  assert.equal(calls.length, 1)
})

test('API navigation, HTML requests and browser resources still require the notice', async (t) => {
  const { url, calls } = await fixture(t)
  const browserHeaders = [
    { 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'empty' },
    { 'sec-fetch-mode': 'navigate', accept: 'text/html;q=0' },
    { 'sec-fetch-dest': 'document', accept: 'application/xhtml+xml;q=0' },
    ...[
      'document',
      'iframe',
      'frame',
      'object',
      'embed',
      'script',
      'image',
    ].map((destination) => ({ 'sec-fetch-dest': destination })),
    { accept: 'text/html' },
    { accept: 'application/xhtml+xml' },
    { accept: 'application/json, TEXT/HTML; q=0.9, */*;q=0.8' },
    { accept: 'application/json, application/xhtml+xml; q=0.9' },
    { accept: 'text/html; charset=utf-8' },
    { accept: 'application/xhtml+xml; charset=utf-8; Q=0.001' },
    { accept: 'text/html;q=1.000' },
    { accept: 'text/html;q=0, application/xhtml+xml' },
    { accept: 'application/xhtml+xml;q=0, text/html;q=0.001' },
    { accept: 'text/html;q=0, text/html;q=0.5' },
    { accept: 'text/html; profile="a;q=0"' },
    { accept: 'text/html; profile="a,b";q="0"' },
    { accept: 'text/html;q=0;q=0' },
    { accept: 'text/html;q=0;Q=0.5' },
    { accept: 'text/html;q=0; profile="unterminated' },
    { accept: 'application/json; profile="unterminated' },
    ...['', 'invalid', '-1', '2', '0oops', '0.0000'].map((quality) => ({
      accept: `text/html;q=${quality}`,
    })),
  ]
  for (const headers of browserHeaders) {
    const response = await request(url, '/api/files', {
      headers: { authorization: 'Bearer test-upload-token', ...headers },
    })
    assert.equal(response.status, 303, JSON.stringify(headers))
    assert.equal(response.headers.location, '/_preview')
  }
  assert.equal(calls.length, 0)
  const acknowledged = await request(url, '/api/files', {
    headers: {
      ...ACK,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      accept: 'text/html',
    },
  })
  assert.equal(acknowledged.status, 200)
  assert.equal(calls.length, 1)
})

test('API-like page paths and query strings cannot skip acknowledgment', async (t) => {
  const { url, calls } = await fixture(t)
  for (const path of [
    '/',
    '/settings',
    '/apiary',
    '/api-files',
    '/api.json',
    '/apix/files',
    '/settings?next=/api/files',
  ]) {
    const response = await request(url, path, {
      headers: { authorization: 'Bearer test-upload-token', accept: '*/*' },
    })
    assert.equal(response.status, 303, path)
    assert.equal(response.headers.location, '/_preview')
  }
  assert.equal((await request(url, '/_preview/api')).status, 404)
  assert.equal(calls.length, 0)
})

test('proxy preserves application traffic and replaces spoofed internal headers', async (t) => {
  const { url, calls } = await fixture(t)
  const response = await request(url, '/api/files?limit=2', {
    method: 'POST',
    body: 'test',
    headers: {
      ...ACK,
      'content-type': 'text/plain',
      'x-middleware-subrequest': 'middleware',
      'x-forwarded-for': 'attacker',
      forwarded: 'for=attacker',
      'x-matched-path': '/api/setup',
      'x-upload-profile': 'preview-profile',
      connection: 'x-secret-hop',
      'x-secret-hop': 'bad',
    },
  })
  assert.equal(response.status, 200)
  assert.equal(calls[0].path, '/api/files?limit=2')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.host, 'flare-test.up.railway.app')
  assert.equal(calls[0].headers['x-forwarded-proto'], 'https')
  assert.equal(calls[0].headers['x-forwarded-for'], '127.0.0.1')
  assert.equal(calls[0].headers['x-upload-profile'], 'preview-profile')
  for (const name of [
    'x-middleware-subrequest',
    'forwarded',
    'x-secret-hop',
    'x-matched-path',
  ])
    assert.equal(calls[0].headers[name], undefined)
  assert.equal(response.headers['content-security-policy'], undefined)
})

test('normal setup, registration, settings and integrations reach Flare unchanged', async (t) => {
  const { url, calls } = await fixture(t)
  const routes = [
    ['GET', '/setup'],
    ['GET', '/register'],
    ['GET', '/api/setup/check'],
    ['POST', '/api/setup'],
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/email/reset'],
    ['POST', '/api/integrations'],
    ['POST', '/api/urls'],
    ['GET', '/u/abc'],
    ['DELETE', '/api/%75sers/id'],
    ['PUT', '/api/profile'],
    ['POST', '/api/profile/upload-token'],
    ['PATCH', '/api/settings/email'],
    ['DELETE', '/api/users/id'],
  ]
  for (const [method, path] of routes) {
    assert.equal(
      (await request(url, path, { method, headers: ACK })).status,
      200,
      path
    )
  }
  assert.deepEqual(
    calls.map(({ method, path }) => [method, path]),
    routes
  )
})

test('ambiguous encoded paths are rejected before calling the private app', async (t) => {
  const { url, calls } = await fixture(t)
  for (const path of [
    '//api/setup',
    '/api/../api/setup',
    '/api/%252e%252e/setup',
    '/api/%2fsetup',
    '/api/%5csetup',
    '/api/setup%3fignored',
    '/api/%00setup',
  ]) {
    assert.equal(
      (await request(url, path, { method: 'POST' })).status,
      400,
      path
    )
  }
  assert.equal(calls.length, 0)
})

test('request targets cannot redirect the connection to another host', async (t) => {
  let foreignCalls = 0
  const foreign = http.createServer((_req, res) => {
    foreignCalls += 1
    res.end('Unexpected foreign request')
  })
  const foreignURL = new URL(await listen(foreign))
  t.after(
    () =>
      new Promise((resolve) => {
        foreign.close(resolve)
        foreign.closeAllConnections()
      })
  )
  const { url, calls } = await fixture(t)
  for (const path of [
    `${foreignURL.origin}/captured`,
    `//${foreignURL.host}/captured`,
    `/\\${foreignURL.host}/captured`,
    `\\${foreignURL.host}/captured`,
    `/%2f${foreignURL.host}/captured`,
    `/%5c${foreignURL.host}/captured`,
    `/%252f%252f${foreignURL.host}/captured`,
    `/http%3a%2f%2f${foreignURL.host}/captured`,
  ]) {
    const response = await request(url, path, {
      headers: { ...ACK, host: foreignURL.host },
    })
    assert.equal(response.status, 400, path)
  }
  assert.equal(calls.length, 0)
  assert.equal(foreignCalls, 0)

  // An ordinary query may contain a URL, but only the configured application
  // receives that path. The visitor's Host header does not select a destination.
  const path = `/api/files?next=${encodeURIComponent(`${foreignURL.origin}/captured`)}`
  const response = await request(url, path, {
    headers: { ...ACK, host: foreignURL.host },
  })
  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, path)
  assert.equal(calls[0].headers.host, 'flare-test.up.railway.app')
  assert.equal(foreignCalls, 0)
})

test('Flare controls authorization and content policies for its pages', async (t) => {
  const policy = "script-src 'self' https://assets.example.test; img-src *"
  const body = '<h1>Flare authorization response</h1>'
  const { url } = await fixture(t, (_req, res) => {
    res.writeHead(403, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': policy,
      'referrer-policy': 'strict-origin',
      'permissions-policy': 'camera=(self)',
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'private, max-age=30',
      'x-robots-tag': 'index, follow',
    })
    res.end(body)
  })
  const response = await request(url, '/settings', { headers: ACK })
  assert.equal(response.status, 403)
  assert.equal(response.body, body)
  assert.equal(response.headers['content-security-policy'], policy)
  assert.equal(response.headers['referrer-policy'], 'strict-origin')
  assert.equal(response.headers['permissions-policy'], 'camera=(self)')
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN')
  assert.equal(response.headers['cache-control'], 'private, max-age=30')
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive')
})

test('declared oversized bodies are rejected before proxying', async (t) => {
  const { url, calls } = await fixture(t)
  const response = await request(url, '/api/files', {
    method: 'POST',
    headers: { 'content-length': MAX_BODY + 1 },
  })
  assert.equal(response.status, 413)
  assert.equal(response.headers.connection, 'close')
  assert.equal(calls.length, 0)
})

test('chunked oversized bodies are capped while streaming', async (t) => {
  const { url } = await fixture(t)
  const response = await request(url, '/api/files', {
    method: 'POST',
    body: Buffer.alloc(MAX_BODY + 1),
  })
  assert.equal(response.status, 413)
})

test('gateway expiry applies even when the app ignores its lifetime', async (t) => {
  let timestamp = Date.now()
  const { url, calls } = await fixture(t, null, { now: () => timestamp })
  timestamp += 7200 * 1000
  for (const path of ['/', '/_preview', '/_preview/health', '/api/files']) {
    assert.equal((await request(url, path)).status, 410)
    assert.equal((await request(url, path, { headers: ACK })).status, 410)
  }
  assert.equal(calls.length, 0)
})

test('health accepts raw setup and completed setup while still checking database health', async (t) => {
  let initialized = false
  let healthy = true
  const { url, calls } = await fixture(t, (req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify(
        req.url === '/api/setup/check'
          ? { completed: initialized }
          : { success: healthy, data: { status: healthy ? 'ok' : 'error' } }
      )
    )
  })
  assert.equal((await request(url, '/_preview/health')).status, 200)
  initialized = true
  assert.equal((await request(url, '/_preview/health')).status, 200)
  assert.deepEqual(calls.map((call) => call.path).sort(), [
    '/api/health',
    '/api/health',
    '/api/setup/check',
    '/api/setup/check',
  ])
  for (const invalid of [null, undefined, 'false', 0]) {
    initialized = invalid
    assert.equal((await request(url, '/_preview/health')).status, 503)
  }
  initialized = false
  healthy = false
  assert.equal((await request(url, '/_preview/health')).status, 503)
})

test('application redirects pass through and oversized responses remain bounded', async (t) => {
  let foreignCalls = 0
  const foreign = http.createServer((_req, res) => {
    foreignCalls += 1
    res.end('The gateway must not follow this redirect')
  })
  const destination = `${await listen(foreign)}/authorize`
  t.after(() => new Promise((resolve) => foreign.close(resolve)))
  const { url } = await fixture(t, (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: destination })
      res.end()
    } else {
      res.writeHead(200, { 'content-length': 17 * 1024 * 1024 })
      res.end()
    }
  })
  const response = await request(url, '/redirect', { headers: ACK })
  assert.equal(response.status, 302)
  assert.equal(response.headers.location, destination)
  assert.equal(foreignCalls, 0)
  assert.equal((await request(url, '/large', { headers: ACK })).status, 502)
})

test('global request limits cannot be bypassed with forwarded IP headers', async (t) => {
  const frozen = Date.now()
  const { url } = await fixture(t, null, { now: () => frozen })
  for (let i = 0; i < 100; i++) {
    const response = await request(url, '/api/files', {
      headers: { 'x-forwarded-for': `192.0.2.${i}` },
    })
    assert.equal(response.status, 200)
  }
  assert.equal(
    (
      await request(url, '/api/files', {
        headers: { 'x-forwarded-for': '192.0.2.254' },
      })
    ).status,
    429
  )
})
