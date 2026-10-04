'use client'

import { useState } from 'react'

import { signIn } from 'next-auth/react'

import {
  type SecurityStatus,
  hasRecentSecurityProof,
  recentSecurityProofName,
} from '@/components/auth/security-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { PasskeyConfirmation } from './passkey-confirmation'

export function readSecurityProof(form: HTMLFormElement) {
  const data = new FormData(form)
  return {
    password: (data.get('proof-password') as string) || undefined,
    code: (data.get('proof-code') as string) || undefined,
  }
}

export function SecurityProof({
  status,
  busy,
  requirePasskey = false,
  onConfirmed,
  onBusyChange,
}: {
  status: SecurityStatus
  busy: boolean
  requirePasskey?: boolean
  onConfirmed: () => Promise<void>
  onBusyChange: (busy: boolean) => void
}) {
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const recent = requirePasskey
    ? status.canUseRecentPasskey
    : hasRecentSecurityProof(status) ||
      (!status.passkeyRequired && !status.hasPassword && status.canUseRecentSso)

  if (recent) {
    return (
      <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
        Your recent{' '}
        {hasRecentSecurityProof(status)
          ? recentSecurityProofName(status)
          : 'SSO'}{' '}
        sign-in confirms your identity for this change.
        {' This confirmation is available for five minutes after sign-in.'}
      </p>
    )
  }

  if (requirePasskey || status.passkeyRequired) {
    return (
      <PasskeyConfirmation
        busy={busy}
        onConfirmed={onConfirmed}
        onBusyChange={onBusyChange}
        allowRecovery={!requirePasskey && status.passkeyRequired}
      />
    )
  }

  if (!status.hasPassword) {
    return (
      <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          Sign in with SSO again to confirm your identity, then return here to
          make this change.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            signIn('oidc', {
              callbackUrl: '/dashboard/profile#sign-in-security',
            })
          }
        >
          Confirm with SSO
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">
        Confirm your identity to make this change.
      </p>
      <div className="space-y-2">
        <Label htmlFor="proof-password">Current password</Label>
        <Input
          id="proof-password"
          name="proof-password"
          type="password"
          autoComplete="current-password"
          data-sensitive="true"
          required
          disabled={busy}
        />
      </div>
      {status.twoFactorEnabled && (
        <div className="space-y-2">
          <Label htmlFor="proof-code">
            {useRecoveryCode ? 'Recovery code' : 'Authenticator code'}
          </Label>
          <Input
            key={String(useRecoveryCode)}
            id="proof-code"
            name="proof-code"
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            data-sensitive="true"
            placeholder={
              useRecoveryCode ? 'Enter a saved recovery code' : '000000'
            }
            pattern={useRecoveryCode ? undefined : '[0-9]{6}'}
            maxLength={useRecoveryCode ? 32 : 6}
            required
            disabled={busy}
          />
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={busy}
            onClick={() => setUseRecoveryCode(!useRecoveryCode)}
          >
            {useRecoveryCode
              ? 'Use an authenticator code'
              : 'Use a recovery code'}
          </Button>
        </div>
      )}
    </div>
  )
}
