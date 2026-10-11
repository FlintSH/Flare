import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { RegisterForm } from '@/components/auth/register-form'
import { Button } from '@/components/ui/button'

import { getConfig } from '@/lib/config'
import { INVITE_LINK_MESSAGES } from '@/lib/invites/policy'
import { inspectInvite } from '@/lib/invites/service'

export const dynamic = 'force-dynamic'
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>
}) {
  const [config, params] = await Promise.all([getConfig(), searchParams])
  const open = config.settings.general.registrations.enabled
  const invite = typeof params.invite === 'string' ? params.invite : undefined

  if (invite === undefined) {
    if (!open) notFound()
    return (
      <AuthShell
        title="Create an account"
        description="Enter your details to get started."
      >
        <RegisterForm />
      </AuthShell>
    )
  }

  const inspected = await inspectInvite(invite)
  const instance = config.settings.customization.published.brand.name
  if (inspected.status === 'active')
    return (
      <AuthShell
        title="You’re invited"
        description={
          inspected.inviterName
            ? `${inspected.inviterName} invited you to join ${instance}. Create your account to get started.`
            : `You’re invited to join ${instance}. Create your account to get started.`
        }
      >
        <RegisterForm invite={invite} inviteRoles={inspected.roles} />
      </AuthShell>
    )

  const message = INVITE_LINK_MESSAGES[inspected.status]
  if (open)
    return (
      <AuthShell
        title="Create an account"
        description="Enter your details to get started."
      >
        <RegisterForm
          notice={`${message} You can still create an account without it.`}
        />
      </AuthShell>
    )

  return (
    <AuthShell
      title="Invite unavailable"
      description={`${message} Ask the person who invited you for a new link.`}
    >
      <Button asChild className="h-11 w-full">
        <Link href="/auth/login">Go to sign in</Link>
      </Button>
    </AuthShell>
  )
}
