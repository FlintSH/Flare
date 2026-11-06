import Link from 'next/link'

import { AlertCircle } from 'lucide-react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import { AuthShell } from '@/components/auth/auth-shell'
import { ResetPasswordForm } from '@/components/email/auth-forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'

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
  const { token } = await searchParams
  if (typeof token !== 'string' || !token)
    return (
      <AuthShell
        title="Choose a new password"
        description="Reset links can be used once and expire after a short time."
      >
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            This reset link is incomplete. It may have been cut off when it was
            copied.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 h-11 w-full">
          <Link href="/auth/forgot-password">Request a new link</Link>
        </Button>
        <AuthFooter>
          <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
            Back to sign in
          </Link>
        </AuthFooter>
      </AuthShell>
    )

  return (
    <AuthShell
      title="Choose a new password"
      description="Your reset link can be used once. After resetting, sign in again with your new password."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
