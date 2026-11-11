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

import {
  RECOVERY_CODE_INPUT_LENGTH,
  TOTP_CODE_PATTERN,
  TOTP_DIGITS,
  TOTP_PLACEHOLDER,
} from '@/lib/auth/security/policy'

import { PasskeyConfirmation } from './passkey-confirmation'
import { PassphraseConfirmation } from './passphrase-confirmation'

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
  showHint = true,
  onConfirmed,
  onBusyChange,
}: {
  status: SecurityStatus
  busy: boolean
  requirePasskey?: boolean
  /** Off when the dialog's description already asks for confirmation. */
  showHint?: boolean
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

  if (status.hasPassphrase) {
    // The passphrase cannot be sent, so the proof is a passphrase sign-in of
    // the last five minutes. The authenticator code is still used up.
    if (!status.canUseRecentPassphrase)
      return (
        <PassphraseConfirmation
          status={status}
          busy={busy}
          onConfirmed={onConfirmed}
          onBusyChange={onBusyChange}
          idPrefix="proof"
        />
      )
    return (
      <div className="space-y-4">
        <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
          Your recent passphrase sign-in confirms your identity for this change.
          This confirmation is available for five minutes after sign-in.
        </p>
        {status.twoFactorEnabled && (
          <CodeField
            busy={busy}
            useRecoveryCode={useRecoveryCode}
            onToggle={() => setUseRecoveryCode(!useRecoveryCode)}
            hint="Use a code that has not signed you in. Each authenticator code works once."
          />
        )}
      </div>
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

  // The fields sit directly in the dialog's form, without a box of their own.
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="proof-password">Current password</Label>
        <Input
          id="proof-password"
          name="proof-password"
          type="password"
          placeholder="Enter your current password"
          autoComplete="current-password"
          data-sensitive="true"
          required
          disabled={busy}
          aria-describedby={showHint ? 'proof-password-hint' : undefined}
        />
        {showHint && (
          <p id="proof-password-hint" className="text-xs text-muted-foreground">
            Confirm your identity to make this change.
          </p>
        )}
      </div>
      {status.twoFactorEnabled && (
        <CodeField
          busy={busy}
          useRecoveryCode={useRecoveryCode}
          onToggle={() => setUseRecoveryCode(!useRecoveryCode)}
        />
      )}
    </div>
  )
}

/** The authenticator or recovery code that a security change uses up. */
function CodeField({
  busy,
  useRecoveryCode,
  onToggle,
  hint,
}: {
  busy: boolean
  useRecoveryCode: boolean
  onToggle: () => void
  hint?: string
}) {
  return (
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
          useRecoveryCode ? 'Enter a saved recovery code' : TOTP_PLACEHOLDER
        }
        pattern={useRecoveryCode ? undefined : TOTP_CODE_PATTERN}
        maxLength={useRecoveryCode ? RECOVERY_CODE_INPUT_LENGTH : TOTP_DIGITS}
        required
        disabled={busy}
        aria-describedby={hint ? 'proof-code-hint' : undefined}
      />
      {hint && (
        <p id="proof-code-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs"
        disabled={busy}
        onClick={onToggle}
      >
        {useRecoveryCode ? 'Use an authenticator code' : 'Use a recovery code'}
      </Button>
    </div>
  )
}
