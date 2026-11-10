/* eslint-disable @typescript-eslint/no-require-imports */
// A minimal OpenID Connect issuer on a loopback port, for the SSO scenarios
// of verify-ui.cjs. It is a stand-in for an identity provider, in the same
// way as the issuer of __tests__/auth/oidc-flow.test.ts: discovery, the
// authorization code flow with PKCE, RS256 ID tokens signed with a key made
// at start, JWKS and userinfo. Flare's side of the flow is real.
//
// It has no sign-in page. The person who "signs in" at the provider is
// whoever the script named with `signInAs` before the redirect arrives.
const {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} = require('node:crypto')
const { createServer } = require('node:http')

function startOidcIssuer({ redirectUri }) {
  const clientId = 'flare-e2ee-suite'
  // Made for this run. It protects nothing: the issuer is disposable.
  const clientSecret = randomBytes(24).toString('base64url')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'flare-e2ee-suite-key',
    use: 'sig',
    alg: 'RS256',
  }
  const codes = new Map()
  const tokens = new Map()
  const authorizations = []
  let identity = null
  let url

  const json = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    const target = new URL(req.url, url)
    if (target.pathname === '/.well-known/openid-configuration')
      return json(res, 200, {
        issuer: url,
        authorization_endpoint: `${url}/authorize`,
        token_endpoint: `${url}/token`,
        userinfo_endpoint: `${url}/userinfo`,
        jwks_uri: `${url}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'email', 'profile'],
      })
    if (target.pathname === '/jwks') return json(res, 200, { keys: [jwk] })
    if (target.pathname === '/authorize') {
      const query = target.searchParams
      if (
        !identity ||
        query.get('client_id') !== clientId ||
        query.get('response_type') !== 'code' ||
        query.get('redirect_uri') !== redirectUri ||
        query.get('code_challenge_method') !== 'S256' ||
        !query.get('code_challenge') ||
        !query.get('state') ||
        !(query.get('scope') || '').split(' ').includes('openid')
      )
        return json(res, 400, { error: 'invalid_request' })
      const code = randomBytes(24).toString('base64url')
      codes.set(code, {
        challenge: query.get('code_challenge'),
        nonce: query.get('nonce'),
        claims: identity,
      })
      authorizations.push(identity.sub)
      const back = new URL(redirectUri)
      back.searchParams.set('code', code)
      back.searchParams.set('state', query.get('state'))
      res.statusCode = 302
      res.setHeader('Location', back.href)
      return res.end()
    }
    if (target.pathname === '/token' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const params = new URLSearchParams(body)
      const grant = codes.get(params.get('code') ?? '')
      const challenge = createHash('sha256')
        .update(params.get('code_verifier') ?? '')
        .digest('base64url')
      if (
        !grant ||
        params.get('grant_type') !== 'authorization_code' ||
        params.get('redirect_uri') !== redirectUri ||
        challenge !== grant.challenge ||
        req.headers.authorization !==
          `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      )
        return json(res, 400, { error: 'invalid_grant' })
      // A code works one time.
      codes.delete(params.get('code'))
      const now = Math.floor(Date.now() / 1000)
      const unsigned = [
        { alg: 'RS256', typ: 'JWT', kid: jwk.kid },
        {
          iss: url,
          aud: clientId,
          iat: now,
          exp: now + 300,
          ...(grant.nonce ? { nonce: grant.nonce } : {}),
          ...grant.claims,
        },
      ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
        .join('.')
      const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey)
      const accessToken = randomBytes(24).toString('base64url')
      tokens.set(accessToken, grant.claims)
      return json(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 300,
        id_token: `${unsigned}.${signature.toString('base64url')}`,
      })
    }
    if (target.pathname === '/userinfo') {
      const claims = tokens.get(
        (req.headers.authorization || '').replace(/^Bearer /, '')
      )
      return claims
        ? json(res, 200, claims)
        : json(res, 401, { error: 'invalid_token' })
    }
    return json(res, 404, {})
  })

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${server.address().port}`
      resolve({
        url,
        clientId,
        clientSecret,
        /** The claims of the person who is signed in at the provider: `sub`, `email`, `email_verified`, `name`. */
        signInAs(claims) {
          identity = claims
        },
        /** The `sub` of each authorization that the provider granted, in order. */
        authorizations,
        close: () => server.close(),
      })
    })
  )
}

module.exports = { startOidcIssuer }
