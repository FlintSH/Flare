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
  assert.match(notice.body, /demo@example.test/)
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
  assert.equal(opened.headers['referrer-policy'], 'no-referrer')
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
  assert.match(
    response.headers['content-security-policy'],
    /connect-src 'self'/
  )
})

test('sensitive routes and encoded bypasses never reach the app', async (t) => {
  const { url, calls } = await fixture(t)
  for (const path of [
    '/api/setup',
    '/api/auth/register',
    '/api/auth/email/reset',
    '/api/integrations',
    '/api/urls',
    '/u/abc',
    '/api/%75sers/id',
  ]) {
    assert.equal(
      (await request(url, path, { method: 'POST', headers: ACK })).status,
      403,
      path
    )
  }
  for (const path of [
    '/api/profile',
    '/api/profile/upload-token',
    '/api/settings/email',
    '/api/users/id',
  ]) {
    assert.equal(
      (await request(url, path, { method: 'DELETE', headers: ACK })).status,
      403,
      path
    )
  }
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
      (await request(url, path, { method: 'POST', headers: ACK })).status,
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

test('read-only setup status remains available to the root page checker', async (t) => {
  const { url, calls } = await fixture(t)
  assert.equal(
    (await request(url, '/api/setup/check', { headers: ACK })).status,
    200
  )
  assert.equal(
    (await request(url, '/api/setup/check', { method: 'POST', headers: ACK }))
      .status,
    403
  )
  assert.equal(calls.length, 1)
})

test('declared oversized bodies are rejected before proxying', async (t) => {
  const { url, calls } = await fixture(t)
  const response = await request(url, '/api/files', {
    method: 'POST',
    headers: { ...ACK, 'content-length': MAX_BODY + 1 },
  })
  assert.equal(response.status, 413)
  assert.equal(response.headers.connection, 'close')
  assert.equal(calls.length, 0)
})

test('chunked oversized bodies are capped while streaming', async (t) => {
  const { url } = await fixture(t)
  const response = await request(url, '/api/files', {
    method: 'POST',
    headers: ACK,
    body: Buffer.alloc(MAX_BODY + 1),
  })
  assert.equal(response.status, 413)
})

test('gateway expiry applies even when the app ignores its lifetime', async (t) => {
  let timestamp = Date.now()
  const { url, calls } = await fixture(t, null, { now: () => timestamp })
  timestamp += 7200 * 1000
  for (const path of ['/', '/_preview', '/_preview/health'])
    assert.equal((await request(url, path, { headers: ACK })).status, 410)
  assert.equal(calls.length, 0)
})

test('health verifies both database setup and app health without redirect following', async (t) => {
  let initialized = false
  const { url, calls } = await fixture(t, (req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify(
        req.url === '/api/setup/check'
          ? { completed: initialized }
          : { success: true, data: { status: 'ok' } }
      )
    )
  })
  assert.equal((await request(url, '/_preview/health')).status, 503)
  initialized = true
  assert.equal((await request(url, '/_preview/health')).status, 200)
  assert.deepEqual(calls.map((call) => call.path).sort(), [
    '/api/health',
    '/api/health',
    '/api/setup/check',
    '/api/setup/check',
  ])
})

test('external redirects and oversized responses are refused', async (t) => {
  const { url } = await fixture(t, (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://169.254.169.254/' })
      res.end()
    } else {
      res.writeHead(200, { 'content-length': 17 * 1024 * 1024 })
      res.end()
    }
  })
  assert.equal((await request(url, '/redirect', { headers: ACK })).status, 502)
  assert.equal((await request(url, '/large', { headers: ACK })).status, 502)
})

test('global request limits cannot be bypassed with forwarded IP headers', async (t) => {
  const frozen = Date.now()
  const { url } = await fixture(t, null, { now: () => frozen })
  for (let i = 0; i < 100; i++) {
    const response = await request(url, '/robots.txt', {
      headers: { 'x-forwarded-for': `192.0.2.${i}` },
    })
    assert.equal(response.status, 200)
  }
  assert.equal(
    (
      await request(url, '/robots.txt', {
        headers: { 'x-forwarded-for': '192.0.2.254' },
      })
    ).status,
    429
  )
})
