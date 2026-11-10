'use client'

import { useState } from 'react'

import { KeyRound } from 'lucide-react'

import type { SecurityStatus } from '@/components/auth/security-api'
import { DERIVING_KEYS } from '@/components/encryption/passphrase-fields'
import { passphraseError } from '@/components/encryption/unlock-dialog'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  RECOVERY_CODE_INPUT_LENGTH,
  SECURITY_LIMIT_MINUTES,
} from '@/lib/auth/security/policy'
import {
  signInWithPassphrase,
  signInWithPassphraseKeys,
  unlockWithKeys,
} from '@/lib/e2ee/client/api'
import {
  wipeAccountKeys,
  wipePassphraseKeys,
} from '@/lib/e2ee/client/procedures'
import { PASSPHRASE_MAX_LENGTH } from '@/lib/e2ee/client/strength'
import { wipe } from '@/lib/e2ee/primitives'

/**
 * The identity check of an account that has encryption keys. Its passphrase
 * cannot be sent to the server, so the proof is a passphrase sign-in of the
 * last five minutes. This control signs the open account in again, in
 * place, as `PasskeyConfirmation` does with a passkey.
 *
 * The fields are not `required` and have no `name` that a surrounding form
 * reads: this control sits inside other forms and must not block or join
 * their submission.
 */
export function PassphraseConfirmation({
  status,
  busy,
  onConfirmed,
  onBusyChange,
  idPrefix = 'confirm',
}: {
  status: SecurityStatus
  busy: boolean
  onConfirmed: () => Promise<void>
  onBusyChange: (busy: boolean) => void
  idPrefix?: string
}) {
  const { state, adopt } = useAccountKeys()
  const [passphrase, setPassphrase] = useState('')
  const [code, setCode] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const identifier =
    state.status === 'locked' || state.status === 'unlocked'
      ? state.identifier
      : null

  async function confirm() {
    if (busy) return
    if (!identifier) {
      setError('Your session is unavailable. Sign in again to continue.')
      return
    }
    if (!passphrase) {
      setError('Enter your passphrase.')
      return
    }
    if (status.twoFactorEnabled && !code.trim()) {
      setError('Enter an authenticator or recovery code.')
      return
    }
    setConfirming(true)
    onBusyChange(true)
    setError(null)
    try {
      const first = await signInWithPassphrase({ identifier, passphrase })
      const keys = first.passphraseKeys
      try {
        let result = first.result
        if (result === 'two-factor-required' && keys)
          result = await signInWithPassphraseKeys({
            identifier,
            passphraseKeys: keys,
            code: code.trim(),
          })
        if (result !== 'signed-in' || !keys) {
          setError(
            result === 'too-many-attempts'
              ? `Too many attempts. Wait ${SECURITY_LIMIT_MINUTES} minutes before trying again.`
              : status.twoFactorEnabled
                ? 'Unable to confirm. Check your passphrase and use a fresh authenticator code.'
                : 'That passphrase is not correct.'
          )
          return
        }
        // The keys are in memory, so a locked browser is unlocked as well.
        if (state.status === 'locked') {
          const opened = await unlockWithKeys(keys).catch(() => null)
          if (opened) {
            await adopt(opened).catch(() => undefined)
            wipe(opened.rootEntropy, ...opened.oldPrivateKeys)
            wipeAccountKeys(opened.accountKeys)
          }
        }
      } finally {
        wipePassphraseKeys(keys)
      }
      setPassphrase('')
      setCode('')
      await onConfirmed()
    } catch (cause) {
      setError(passphraseError(cause))
    } finally {
      setConfirming(false)
      onBusyChange(false)
    }
  }

  function onEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    // Enter confirms the passphrase. It must not submit the form around it.
    event.preventDefault()
    void confirm()
  }

  return (
    <div
      className="space-y-3 rounded-xl border bg-muted/30 p-4"
      data-passphrase-confirmation=""
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Confirm your passphrase to continue. It stays in this browser, and the
        confirmation lasts five minutes.
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-passphrase`}>Passphrase</Label>
        <Input
          id={`${idPrefix}-passphrase`}
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          onKeyDown={onEnter}
          placeholder="Enter your passphrase"
          autoComplete="current-password"
          maxLength={PASSPHRASE_MAX_LENGTH}
          disabled={busy}
          data-sensitive="true"
        />
      </div>
      {status.twoFactorEnabled && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-passphrase-code`}>
            Authenticator or recovery code
          </Label>
          <Input
            id={`${idPrefix}-passphrase-code`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={onEnter}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={RECOVERY_CODE_INPUT_LENGTH}
            placeholder="Enter an authenticator or recovery code"
            disabled={busy}
            data-sensitive="true"
          />
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void confirm()}
      >
        <KeyRound aria-hidden="true" />
        {confirming ? DERIVING_KEYS : 'Confirm passphrase'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
