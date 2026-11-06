import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { RegisterForm } from '@/components/auth/register-form'
import { Button } from '@/components/ui/button'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { getEmailCapabilities } from '@/lib/email/config'
import { isEnforcedVerificationMode } from '@/lib/email/policy'
import { INVITE_LINK_MESSAGES } from '@/lib/invites/policy'
import { inspectInvite } from '@/lib/invites/service'
import { SETUP_PATH } from '@/lib/setup/navigation'
import { pageSetupStatus } from '@/lib/setup/status'

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
  const [config, params, verificationRequired, setupComplete] =
    await Promise.all([
      getConfig(),
      searchParams,
      // Unreadable email settings leave out the notice rather than the form.
      getEmailCapabilities().then(
        (email) => isEnforcedVerificationMode(email.verificationMode),
        () => false
      ),
      pageSetupStatus(),
    ])
  if (setupComplete === false) redirect(SETUP_PATH)
  const open = config.settings.general.registrations.enabled
  const invite = typeof params.invite === 'string' ? params.invite : undefined

  if (invite === undefined) {
    if (!open) notFound()
    return (
      <AuthShell
        title="Create an account"
        description="Enter your details to get started."
      >
        <RegisterForm verificationRequired={verificationRequired} />
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
        <RegisterForm
          invite={invite}
          inviteRoles={inspected.roles}
          verificationRequired={verificationRequired}
        />
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
          verificationRequired={verificationRequired}
        />
      </AuthShell>
    )

  return (
    <AuthShell
      title="Invite unavailable"
      description={`${message} Ask the person who invited you for a new link.`}
    >
      <Button asChild className="h-11 w-full">
        <Link href={SIGN_IN_PATH}>Go to sign in</Link>
      </Button>
    </AuthShell>
  )
}
