import { routes } from '@/lib/http/route'
import { mcpEnabled } from '@/lib/mcp/settings'
import { AUDIT_CATEGORY, AUTHORIZE_PATH } from '@/lib/oauth/constants'
import { clearedCookies, pendingQuery } from '@/lib/oauth/cookies'
import { browserRoutes, redirectTo } from '@/lib/oauth/http'
import { issuer } from '@/lib/oauth/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const pages = routes('/api/oauth/authorize/resume', {
  ...browserRoutes,
  // One hop of a sign-in that the authorize endpoint records.
  audit: {
    action: 'oauth.authorize.resume',
    category: AUDIT_CATEGORY,
    skipSuccess: true,
  },
})

/**
 * Where a browser goes once the person has signed in while a sign-in for an
 * agent was waiting. It clears both cookies, so it happens once, and sends
 * the browser to the authorize endpoint with the stored query, which checks
 * it again as if the client had just sent it. The destination is that one
 * path or the dashboard, whatever the cookie holds.
 *
 * While the MCP server is off there is nothing to resume, but the cookies
 * still have to go: left in place they would send every page here again.
 */
export const GET = pages(async (request) => {
  const query = (await mcpEnabled()) ? pendingQuery(request) : null
  return redirectTo(
    query ? `${AUTHORIZE_PATH}?${query}` : '/dashboard',
    clearedCookies(issuer(request).startsWith('https:'))
  )
})
