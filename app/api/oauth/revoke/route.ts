import { routes } from '@/lib/http/route'
import { AUDIT_CATEGORY } from '@/lib/oauth/constants'
import {
  OAuthError,
  POST_HEADERS,
  clientRoutes,
  openPreflight,
  readOAuthForm,
  whileOn,
} from '@/lib/oauth/http'
import { revokeByToken } from '@/lib/oauth/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const api = routes('/api/oauth/revoke', {
  ...clientRoutes,
  audit: { action: 'oauth.revoke', category: AUDIT_CATEGORY },
})

/**
 * RFC 7009: a client hands back a token it no longer needs, and the
 * connection the token belongs to ends. The answer is 200 whether or not
 * Flare knew the token, so it says nothing about which tokens exist.
 */
export const POST = whileOn(
  api(async (request) => {
    const token = (await readOAuthForm(request)).get('token')
    if (!token)
      throw new OAuthError('invalid_request', 'The token parameter is missing.')
    await revokeByToken(token)
    return new Response(null, { status: 200 })
  })
)

export const OPTIONS = openPreflight('POST, OPTIONS', POST_HEADERS)
