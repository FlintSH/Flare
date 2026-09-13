'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'

import { EmailSettings } from './email-settings'

export function SetupEmail() {
  const router = useRouter()
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your account is ready · Optional final step
        </p>
        <h1 className="text-3xl font-bold">Make your account recoverable</h1>
        <p className="text-muted-foreground">
          Add an email provider now, or come back to Settings → Email whenever
          you are ready.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard">Set up email later</Link>
        </Button>
      </div>
      <EmailSettings
        setup
        onComplete={(config) => {
          router.push(config.enabled ? '/auth/verify-email' : '/dashboard')
          router.refresh()
        }}
      />
    </main>
  )
}
