import { setAuditTarget } from '@/lib/audit'
import { HttpError } from '@/lib/http/errors'
import { readBody } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { registerClient } from '@/lib/oauth/clients'
import { AUDIT_CATEGORY, REGISTRATION_BODY_BYTES } from '@/lib/oauth/constants'
import {
  OAuthError,
  POST_HEADERS,
  clientRoutes,
  openPreflight,
  whileOn,
} from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const api = routes('/api/oauth/register', {
  ...clientRoutes,
  audit: { action: 'oauth.register', category: AUDIT_CATEGORY },
})

/**
 * RFC 7591: a client registers itself and is given a `client_id`. Nobody is
 * signed in and no cookie is read; what a registration can do is bounded by
 * its size, the redirect address rules and the rate limit.
 */
export const POST = whileOn(
  api(async (request) => {
    const body = await readBody(request, REGISTRATION_BODY_BYTES).catch(
      (error: unknown) => {
        throw error instanceof HttpError && error.status === 413
          ? new OAuthError(
              'invalid_client_metadata',
              `A registration can be at most ${REGISTRATION_BODY_BYTES / 1024} KB.`,
              413
            )
          : error
      }
    )
    let metadata: unknown
    try {
      metadata = JSON.parse(body.toString('utf8'))
    } catch {
      throw new OAuthError(
        'invalid_client_metadata',
        'The registration must be a JSON object.'
      )
    }
    const client = await registerClient(request, metadata)
    setAuditTarget({
      type: 'oauth_client',
      id: client.client_id,
      name: client.client_name,
    })
    return Response.json(client, { status: 201 })
  })
)

export const OPTIONS = openPreflight('POST, OPTIONS', POST_HEADERS)
