import Link from 'next/link'

import { AlertCircle } from 'lucide-react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import { AuthShell } from '@/components/auth/auth-shell'
import { ResetPasswordForm } from '@/components/email/auth-forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getEmailCapabilities } from '@/lib/email/config'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Choose a new password · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const [{ token }, recoveryEnabled] = await Promise.all([
    searchParams,
    getEmailCapabilities()
      .then((capabilities) => capabilities.recoveryEnabled)
      .catch(() => null),
  ])
  if (typeof token !== 'string' || !token)
    return (
      <AuthShell
        title="Choose a new password"
        description={
          recoveryEnabled === false
            ? 'Contact the person who provided or manages your account for help signing in.'
            : recoveryEnabled === null
              ? 'Recovery availability could not be checked. Check your recovery options or return to sign in.'
              : 'Reset links can be used once and expire after a short time.'
        }
      >
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            This reset link is incomplete. It may have been cut off when it was
            copied.
            {recoveryEnabled === false &&
              ' Email password recovery is not enabled on this instance.'}
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 h-11 w-full">
          <Link
            href={
              recoveryEnabled === false
                ? LOCAL_SIGN_IN_PATH
                : '/auth/forgot-password'
            }
          >
            {recoveryEnabled === false
              ? 'Back to sign in'
              : recoveryEnabled === null
                ? 'Check recovery options'
                : 'Request a new link'}
          </Link>
        </Button>
        {recoveryEnabled !== false && (
          <AuthFooter>
            <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
              Back to sign in
            </Link>
          </AuthFooter>
        )}
      </AuthShell>
    )

  return (
    <AuthShell
      title="Choose a new password"
      description="Your reset link can be used once. After resetting, sign in again with your new password."
    >
      <ResetPasswordForm token={token} recoveryEnabled={recoveryEnabled} />
    </AuthShell>
  )
}
