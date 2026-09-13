// Trusted public boundary; never build this image from an unreviewed PR.
const http = require('node:http')

const MAX_BODY = 6 * 1024 * 1024
const MAX_RESPONSE = 16 * 1024 * 1024
const COOKIE = 'flare_preview_ack=1'
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const SAFE_HEADERS = {
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
}

function configuration(env, options) {
  const upstream = new URL(env.PREVIEW_UPSTREAM)
  const origin = new URL(env.PREVIEW_PUBLIC_URL)
  const expires = Number(env.PREVIEW_EXPIRES_AT)
  if (
    upstream.href !== 'http://preview-app.railway.internal:3000/' ||
    origin.protocol !== 'https:' ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.up\.railway\.app$/.test(
      origin.hostname
    ) ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !Number.isSafeInteger(expires) ||
    expires <= 0
  )
    throw new Error('Invalid preview gateway configuration')
  // Tests may inject a local upstream explicitly; production never reads an override.
  return {
    upstream: new URL(options.upstreamForTests || upstream),
    origin,
    expires,
  }
}

function pathname(target) {
  if (
    !target.startsWith('/') ||
    target.startsWith('//') ||
    /[\x00-\x20#\\]/.test(target)
  )
    throw new Error('Invalid path')
  const decoded = decodeURIComponent(target.split('?')[0])
  if (
    /[\x00-\x20%?#\\]/.test(decoded) ||
    decoded.includes('//') ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid path')
  return decoded.toLowerCase().replace(/\/$/, '') || '/'
}

function restricted(path, method) {
  // The root SetupChecker needs this read on every normal page load.
  if (path === '/api/setup/check' && ['GET', 'HEAD'].includes(method))
    return false
  if (/^\/(?:setup|register|u)(?:\/|$)/.test(path)) return true
  if (
    /^\/api\/(?:setup|auth\/(?:register|email)|integrations|urls)(?:\/|$)/.test(
      path
    )
  )
    return true
  if (['GET', 'HEAD'].includes(method)) return false
  return /^\/api\/(?:settings|users|profile)(?:\/|$)/.test(path)
}

function headers(source, incoming = false) {
  const excluded = new Set([
    ...HOP_HEADERS,
    ...String(source.connection || '')
      .toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ])
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name]) =>
        !excluded.has(name) &&
        !(incoming && name.startsWith('x-') && name !== 'x-upload-profile') &&
        !name.startsWith('x-middleware') &&
        !name.startsWith('x-forwarded-') &&
        name !== 'forwarded' &&
        name !== 'x-real-ip' &&
        name !== 'x-original-url' &&
        name !== 'x-rewrite-url'
    )
  )
}

function probe(upstream, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(path, upstream), { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('Unhealthy upstream'))
        return
      }
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > 8192)
          res.destroy(new Error('Oversized health response'))
      })
      res.on('error', reject)
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('Invalid health response'))
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('Health timeout')))
    req.on('error', reject)
    // Socket timeouts alone do not bound a slow but continuously streaming body.
    const deadline = setTimeout(
      () => req.destroy(new Error('Health deadline')),
      4000
    )
    req.on('close', () => clearTimeout(deadline))
  })
}

function createGateway(env = process.env, options = {}) {
  const config = configuration(env, options)
  const now = options.now || Date.now
  let tokens = 100
  let lastRefill = now()
  let active = 0
  const server = http.createServer(async (req, res) => {
    const reply = (status, text, extra = {}) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        ...SAFE_HEADERS,
        ...extra,
        ...(status >= 400 ? { connection: 'close' } : {}),
      })
      res.end(text)
    }
    if (now() >= config.expires * 1000)
      return reply(410, 'This public preview has expired.')
    tokens = Math.min(100, tokens + Math.max(0, now() - lastRefill) * 0.02)
    lastRefill = now()
    if (tokens < 1 || active >= 32)
      return reply(429, 'Preview is busy. Try again shortly.', {
        'retry-after': '5',
      })
    tokens -= 1
    active += 1
    res.once('close', () => {
      active -= 1
    })
    const remaining = config.expires * 1000 - now()
    const deadline = setTimeout(
      () =>
        remaining <= 30000
          ? reply(410, 'This public preview has expired.')
          : reply(504, 'Preview request timed out.'),
      Math.min(30000, remaining)
    )
    res.once('close', () => clearTimeout(deadline))
    let path
    try {
      path = pathname(req.url)
    } catch {
      return reply(400, 'Invalid preview path.')
    }
    if (
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(
        req.method
      )
    )
      return reply(405, 'Unsupported method.')
    if (Number(req.headers['content-length'] || 0) > MAX_BODY)
      return reply(413, 'Preview requests are limited to 6 MiB.')
    if (path === '/_preview/health' && req.method === 'GET') {
      try {
        const [setup, health] = await Promise.all([
          probe(config.upstream, '/api/setup/check'),
          probe(config.upstream, '/api/health'),
        ])
        if (
          setup.completed !== true ||
          health.success !== true ||
          health.data?.status !== 'ok'
        )
          throw new Error('Preview not initialized')
        return reply(200, '{"status":"ready"}', {
          'content-type': 'application/json',
        })
      } catch {
        return reply(503, 'Preview is starting.')
      }
    }
    if (path === '/robots.txt')
      return reply(200, 'User-agent: *\nDisallow: /\n')
    if (path === '/_preview' && ['GET', 'HEAD'].includes(req.method)) {
      return reply(
        200,
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Flare public PR preview</title><body><main><h1>Public, disposable PR preview</h1><p>This site runs unreviewed pull request code. Everyone shares its test data. Use made-up data only; never enter real passwords, personal files, or production credentials.</p><p>Demo login: <code>demo@example.test</code><br>Password: <code>Flare-preview-only!2026</code></p><p>This preview expires automatically. Some settings and integrations are disabled.</p><form method="post" action="/_preview/enter"><button>I understand — open preview</button></form></main></body></html>',
        {
          'content-type': 'text/html; charset=utf-8',
          // A no-referrer document submits navigation forms with Origin:null.
          // Preserve this same-origin POST while withholding cross-origin referrers.
          'referrer-policy': 'same-origin',
        }
      )
    }
    if (path === '/_preview/enter' && req.method === 'POST') {
      if (req.headers.origin !== config.origin.origin)
        return reply(403, 'Open the preview notice first.')
      const remaining = Math.max(0, Math.floor(config.expires - now() / 1000))
      return reply(303, '', {
        location: '/',
        'set-cookie': `${COOKIE}; Path=/; Max-Age=${remaining}; HttpOnly; Secure; SameSite=Lax`,
      })
    }
    if (path.startsWith('/_preview')) return reply(404, 'Not found.')
    if (restricted(path, req.method))
      return reply(403, 'This operation is disabled in public previews.')
    if (
      !String(req.headers.cookie || '')
        .split(';')
        .some((cookie) => cookie.trim() === COOKIE)
    )
      return reply(303, '', { location: '/_preview' })

    const outgoing = headers(req.headers, true)
    outgoing.host = config.origin.host
    outgoing['x-forwarded-host'] = config.origin.host
    outgoing['x-forwarded-proto'] = 'https'
    outgoing['x-forwarded-for'] = '127.0.0.1'
    const proxy = http.request(
      {
        // Visitor input is only the validated request path. Connection routing
        // always comes from the fixed private upstream, never URL resolution.
        protocol: config.upstream.protocol,
        hostname: config.upstream.hostname,
        port: config.upstream.port,
        path: req.url,
        method: req.method,
        headers: outgoing,
        timeout: 15000,
      },
      (upstream) => {
        const responseHeaders = headers(upstream.headers)
        if (responseHeaders.location) {
          try {
            const redirect = new URL(responseHeaders.location, config.origin)
            if (redirect.origin !== config.origin.origin)
              throw new Error('External redirect')
          } catch {
            upstream.destroy()
            return reply(
              502,
              'External redirects are disabled in public previews.'
            )
          }
        }
        if (Number(responseHeaders['content-length'] || 0) > MAX_RESPONSE) {
          upstream.destroy()
          return reply(502, 'Preview response exceeds the size limit.')
        }
        res.writeHead(upstream.statusCode, {
          ...responseHeaders,
          ...SAFE_HEADERS,
        })
        let received = 0
        upstream.on('data', (chunk) => {
          received += chunk.length
          if (received > MAX_RESPONSE || now() >= config.expires * 1000) {
            upstream.destroy()
            res.destroy()
          }
        })
        upstream.on('error', () => res.destroy())
        upstream.pipe(res)
      }
    )
    let uploaded = 0
    req.on('data', (chunk) => {
      uploaded += chunk.length
      if (uploaded > MAX_BODY) {
        req.unpipe(proxy)
        reply(413, 'Preview requests are limited to 6 MiB.')
        proxy.destroy()
      }
    })
    req.on('aborted', () => proxy.destroy())
    req.on('error', () => proxy.destroy())
    res.once('close', () => proxy.destroy())
    proxy.on('timeout', () => proxy.destroy(new Error('Upstream timeout')))
    proxy.on('error', () => {
      if (!res.writableEnded) reply(502, 'Preview is unavailable.')
    })
    req.pipe(proxy)
  })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 100
  server.maxConnections = 128
  server.maxRequestsPerSocket = 100
  server.on('upgrade', (_req, socket) => socket.destroy())
  server.on('connect', (_req, socket) => socket.destroy())
  return server
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid gateway port')
  createGateway().listen(port, '::')
}

module.exports = { createGateway, pathname, restricted, MAX_BODY }
