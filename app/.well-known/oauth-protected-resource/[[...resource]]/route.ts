import { routes } from '@/lib/http/route'
import { mcpNotFound } from '@/lib/mcp/settings'
import { AUDIT_CATEGORY } from '@/lib/oauth/constants'
import { clientRoutes, openPreflight, whileOn } from '@/lib/oauth/http'
import { mcpResource, protectedResourceMetadata } from '@/lib/oauth/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ resource?: string[] }> }

const metadata = routes(
  '/.well-known/oauth-protected-resource/[[...resource]]',
  {
    ...clientRoutes,
    audit: {
      action: 'oauth.metadata',
      category: AUDIT_CATEGORY,
      skipSuccess: true,
    },
  }
)

/**
 * RFC 9728: what protects the MCP endpoint. The document lives at the
 * well-known path followed by the resource's own path, which is where the
 * 401 from the endpoint points, and at the bare well-known path for clients
 * that look there. Flare protects nothing else, so any other path is not
 * found.
 */
export const GET = whileOn(
  metadata(async (request, { params }: Context) => {
    const path = ((await params).resource ?? []).join('/')
    const known = [
      '',
      'api/mcp',
      new URL(mcpResource(request)).pathname.slice(1),
    ]
    return known.includes(path)
      ? protectedResourceMetadata(request)
      : mcpNotFound()
  })
)

/** Clients in a browser send the protocol version along, which needs a preflight. */
export const OPTIONS = openPreflight('GET, OPTIONS', 'MCP-Protocol-Version')
