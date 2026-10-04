'use client'

import { useState } from 'react'

import { Fingerprint } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { signInWithPasskey } from '@/components/auth/passkey-sign-in'
import { passkeyError } from '@/components/auth/security-api'
import { Button } from '@/components/ui/button'

export function PasskeyConfirmation({
  busy,
  onConfirmed,
  onBusyChange,
  allowRecovery = true,
}: {
  busy: boolean
  onConfirmed: () => Promise<void>
  onBusyChange: (busy: boolean) => void
  allowRecovery?: boolean
}) {
  const { data: session } = useSession()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!session?.user.id) {
      setError('Your session is unavailable. Sign in again to continue.')
      return
    }
    setConfirming(true)
    onBusyChange(true)
    setError(null)
    try {
      await signInWithPasskey(session.user.id)
      await onConfirmed()
    } catch (error) {
      setError(passkeyError(error))
    } finally {
      setConfirming(false)
      onBusyChange(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">
        Confirm with a passkey for this account to continue. Confirmation lasts
        five minutes.
        {allowRecovery &&
          ' If your passkey is unavailable, sign out and use a saved passkey recovery code to restore access.'}
      </p>
      <Button type="button" variant="outline" disabled={busy} onClick={confirm}>
        <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
        {confirming ? 'Confirming…' : 'Confirm with a passkey'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
