import { routes } from '@/lib/http/route'
import { AUDIT_CATEGORY } from '@/lib/oauth/constants'
import { clientRoutes, openPreflight, whileOn } from '@/lib/oauth/http'
import { authorizationServerMetadata } from '@/lib/oauth/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const metadata = routes('/.well-known/oauth-authorization-server', {
  ...clientRoutes,
  // A fixed document clients read before every sign-in: only a failure is
  // worth a line in the log.
  audit: {
    action: 'oauth.metadata',
    category: AUDIT_CATEGORY,
    skipSuccess: true,
  },
})

/** RFC 8414: where a client registers, sends the person, and gets its tokens. */
export const GET = whileOn(
  metadata(async (request) => authorizationServerMetadata(request))
)

/** Clients in a browser send the protocol version along, which needs a preflight. */
export const OPTIONS = openPreflight('GET, OPTIONS', 'MCP-Protocol-Version')
