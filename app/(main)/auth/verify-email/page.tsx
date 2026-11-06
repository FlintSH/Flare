import Link from 'next/link'

import { LogIn } from 'lucide-react'

import { AuthShell } from '@/components/auth/auth-shell'
import { VerifyEmailForm } from '@/components/email/auth-forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { getRequestSession } from '@/lib/auth/page-session'
import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'

export const metadata = {
  title: 'Confirm your email · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const emailToken = typeof token === 'string' ? token : ''
  // A link from an email works signed out. Without one, the page shows the
  // account's status, which needs a session, so ask the visitor to sign in.
  if (!emailToken && !(await getRequestSession())?.user)
    return (
      <AuthShell
        title="Confirm your email"
        description="Keep your account reachable and enable secure email recovery."
      >
        <Alert variant="info" role="status">
          <LogIn aria-hidden="true" />
          <AlertDescription>
            Sign in to check your email status or request another confirmation
            email.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 h-11 w-full">
          <Link href={LOCAL_SIGN_IN_PATH}>Sign in</Link>
        </Button>
      </AuthShell>
    )

  return (
    <AuthShell
      title="Confirm your email"
      description="Keep your account reachable and enable secure email recovery."
    >
      <VerifyEmailForm token={emailToken} />
    </AuthShell>
  )
}
