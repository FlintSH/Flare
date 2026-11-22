import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { ArrowRight } from 'lucide-react'

import { AuthShell } from '@/components/auth/auth-shell'
import { ConnectForm } from '@/components/auth/connect-form'
import { Button } from '@/components/ui/button'

import { getPageSession } from '@/lib/auth/page-session'
import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { API_SCOPES, MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import { scopeAvailable } from '@/lib/mcp/catalog'
import { returnDestination, shownClientName } from '@/lib/mcp/clients'
import { administrationOn, mcpEnabled } from '@/lib/mcp/settings'
import { readConsentRequest } from '@/lib/oauth/authorize'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Connect an agent · Flare',
  robots: { index: false, follow: false },
  // The address holds the request.
  referrer: 'no-referrer' as const,
}

/**
 * The consent screen of an agent's sign-in. `/api/oauth/authorize` sends a
 * signed-in browser here with the request it has checked and signed; the
 * decision is posted back to it.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string | string[] }>
}) {
  if (!(await mcpEnabled())) notFound()
  const session = await getPageSession()
  if (!session?.user) redirect(SIGN_IN_PATH)
  const { request } = await searchParams
  const signed =
    typeof request === 'string' ? readConsentRequest(request) : null
  // A request checked for one account is of no use to another.
  const consent = signed?.userId === session.user.id ? signed : null
  const destination = consent && returnDestination(consent.redirectUri)
  if (typeof request !== 'string' || !consent || !destination)
    return (
      <AuthShell
        title="Start the connection again"
        description="This request has expired or is not valid. Go back to your agent and connect again."
      >
        <Button asChild className="h-11 w-full">
          <Link href="/dashboard">
            Go to your files
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </AuthShell>
    )

  const can = (permission: Permission) =>
    hasPermission(session.user, permission)
  // Signing an agent in needs what creating a token for one needs.
  const allowed = can('tokens.manage')
  const administration = allowed && (await administrationOn())
  return (
    <AuthShell
      title="Connect an agent"
      description={
        allowed
          ? 'Only allow a connection you started yourself.'
          : 'Your role does not allow connecting agents. Ask an administrator if you need this.'
      }
    >
      <ConnectForm
        request={request}
        clientName={shownClientName(consent.clientName)}
        destination={destination}
        account={session.user.name}
        available={
          allowed
            ? API_SCOPES.filter(
                (scope) =>
                  scope !== MCP_SCOPE &&
                  scopeAvailable(scope, can, true, administration)
              )
            : null
        }
        ceiling={consent.scopeCeiling}
      />
    </AuthShell>
  )
}
