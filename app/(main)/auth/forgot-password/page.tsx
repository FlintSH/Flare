import Link from 'next/link'

import { Info } from 'lucide-react'

import { AuthShell } from '@/components/auth/auth-shell'
import { ForgotPasswordForm } from '@/components/email/auth-forms'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { getEmailCapabilities } from '@/lib/email/config'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Reset your password · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

async function recoveryAvailable() {
  try {
    return (await getEmailCapabilities()).recoveryEnabled
  } catch {
    // The form checks again in the browser and explains a failure there.
    return null
  }
}

export default async function ForgotPasswordPage() {
  if ((await recoveryAvailable()) === false)
    return (
      <AuthShell
        title="Forgot your password?"
        description="Ask your administrator for help signing in."
      >
        <Alert variant="info" role="status">
          <Info aria-hidden="true" />
          <AlertDescription>
            Email password recovery isn’t enabled on this instance.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 h-11 w-full">
          <Link href="/auth/login?local=1">Back to sign in</Link>
        </Button>
      </AuthShell>
    )

  return (
    <AuthShell
      title="Forgot your password?"
      description="Enter your account email and we will send a reset link if recovery is available for it."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
