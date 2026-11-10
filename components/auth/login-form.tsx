'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { AlertCircle, ArrowLeft, Fingerprint, ShieldCheck } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import { signInWithPasskey } from '@/components/auth/passkey-sign-in'
import { passkeyError } from '@/components/auth/security-api'
import { DERIVING_KEYS } from '@/components/encryption/passphrase-fields'
import {
  KEY_SETUP_PATH,
  useAccountKeys,
} from '@/components/providers/account-keys-provider'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  RECOVERY_CODE_INPUT_LENGTH,
  SECURITY_CODE_MAX_LENGTH,
  TOTP_CODE_PATTERN,
  TOTP_DIGITS,
  TOTP_PLACEHOLDER,
} from '@/lib/auth/security/policy'
import {
  SignInError,
  TOO_MANY_SIGN_IN_ATTEMPTS,
  getOidcErrorMessage,
} from '@/lib/auth/sign-in'
import type { PassphraseKeys } from '@/lib/e2ee/account'
import {
  requestSignInChallenge,
  signInWithPassphrase,
  signInWithPassphraseKeys,
  unlockWithKeys,
} from '@/lib/e2ee/client/api'
import { offerLegacyPassword } from '@/lib/e2ee/client/legacy-password'
import {
  wipeAccountKeys,
  wipePassphraseKeys,
} from '@/lib/e2ee/client/procedures'
import { PASSPHRASE_MAX_LENGTH } from '@/lib/e2ee/client/strength'
import { isE2eeError } from '@/lib/e2ee/errors'
import { wipe } from '@/lib/e2ee/primitives'
import { getSetupResumePathAfterSignIn } from '@/lib/setup/navigation'
import { cn } from '@/lib/utils'

const disabledLink = 'disabled:cursor-not-allowed disabled:opacity-50'

const PASSKEY_REQUIRED =
  'This account requires a passkey. Sign in with a registered passkey or use a dedicated passkey recovery code. Passphrase, password and SSO sign-in are blocked.'

/** Which secret the account of the typed address signs in with. */
type SecretMethod = 'passphrase' | 'password'

/**
 * The one step that the form shows. Sign-in starts with the address, because
 * the server says which secret that account uses (docs/e2ee-spec.md,
 * sections 6.1 and 14.1).
 */
type Stage =
  | { name: 'identifier' }
  | { name: 'secret'; identifier: string; method: SecretMethod }
  | { name: 'code'; identifier: string; method: SecretMethod }
  | { name: 'passkey-recovery' }

type Activity = 'continue' | 'deriving' | 'signing-in' | 'passkey' | 'oidc'

interface LoginFormProps {
  registrationsEnabled: boolean
  disabledMessage: string
  oidcEnabled?: boolean
  oidcButtonText?: string
  /** Link to passphrase recovery by email. */
  recoveryEnabled: boolean
}

export function LoginForm({
  registrationsEnabled,
  disabledMessage,
  oidcEnabled = false,
  oidcButtonText = 'Sign in with SSO',
  recoveryEnabled,
}: Readonly<LoginFormProps>) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { adopt } = useAccountKeys()
  const [stage, setStage] = useState<Stage>({ name: 'identifier' })
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  // Secrets stay in memory only while the second factor is completed. The
  // passphrase itself is never kept: only the keys that it gave.
  const pendingPassword = useRef<string | null>(null)
  const pendingKeys = useRef<PassphraseKeys | null>(null)
  const busy = activity !== null

  function forgetSecrets() {
    pendingPassword.current = null
    wipePassphraseKeys(pendingKeys.current)
    pendingKeys.current = null
  }

  useEffect(() => {
    setPasskeysSupported(window.isSecureContext && !!window.PublicKeyCredential)
    return () => {
      pendingPassword.current = null
      wipePassphraseKeys(pendingKeys.current)
      pendingKeys.current = null
    }
  }, [])

  useEffect(() => {
    const errorCode = searchParams.get('error')
    if (errorCode) setError(getOidcErrorMessage(errorCode))
  }, [searchParams])

  function show(next: Stage) {
    setStage(next)
    setUseRecoveryCode(false)
    setError(null)
  }

  function startOver() {
    forgetSecrets()
    show({ name: 'identifier' })
  }

  function finishSignIn() {
    forgetSecrets()
    // Only allow these fixed callbacks on the current origin.
    router.push(getSetupResumePathAfterSignIn(searchParams) ?? '/dashboard')
    router.refresh()
  }

  async function onOidcSignIn() {
    setActivity('oidc')
    setError(null)
    try {
      await signIn('oidc', { callbackUrl: '/dashboard' })
    } catch {
      setError('Unable to start sign-in. Please try again.')
      setActivity(null)
    }
  }

  async function onPasskeySignIn() {
    setActivity('passkey')
    setError(null)
    try {
      await signInWithPasskey()
      finishSignIn()
    } catch (cause) {
      setError(passkeyError(cause))
    } finally {
      setActivity(null)
    }
  }

  /**
   * Section 6.2, step 9: the session exists, so the keys in memory unlock the
   * account. A failure here leaves a signed-in, locked browser, which the
   * application handles with its unlock prompt.
   */
  async function unlockAndFinish(keys: PassphraseKeys) {
    try {
      const opened = await unlockWithKeys(keys)
      try {
        await adopt(opened)
      } finally {
        wipe(opened.rootEntropy, ...opened.oldPrivateKeys)
        wipeAccountKeys(opened.accountKeys)
      }
    } catch {
      // Signed in and locked.
    }
    finishSignIn()
  }

  async function submitIdentifier(identifier: string) {
    setActivity('continue')
    try {
      const answer = await requestSignInChallenge(identifier)
      show({ name: 'secret', identifier, method: answer.method })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to start sign-in. Please try again.'
      )
    } finally {
      setActivity(null)
    }
  }

  async function submitPasskeyRecovery(data: FormData) {
    setActivity('signing-in')
    try {
      const result = await signIn('passkey-recovery', {
        email: data.get('email'),
        code: data.get('code'),
        redirect: false,
        callbackUrl: '/dashboard',
      })
      if (!result?.ok || result.error) {
        setError(
          result?.error === SignInError.TooManyAttempts
            ? TOO_MANY_SIGN_IN_ATTEMPTS
            : 'Unable to sign in. Check your email address and use an unused passkey recovery code from your latest set.'
        )
        return
      }
      finishSignIn()
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setActivity(null)
    }
  }

  /** The password sign-in of an account from before encryption, then its key setup. */
  async function submitPassword(
    identifier: string,
    password: string,
    code?: string
  ) {
    setActivity('signing-in')
    try {
      const result = await signIn('credentials', {
        email: identifier,
        password,
        ...(code ? { code } : {}),
        redirect: false,
        callbackUrl: '/dashboard',
      })
      if (result?.error === SignInError.TwoFactorRequired) {
        pendingPassword.current = password
        show({ name: 'code', identifier, method: 'password' })
        return
      }
      if (result?.error === SignInError.PasskeyRequired) {
        forgetSecrets()
        setError(PASSKEY_REQUIRED)
        return
      }
      if (!result || result.error) {
        setError(
          result?.error === SignInError.TooManyAttempts
            ? TOO_MANY_SIGN_IN_ATTEMPTS
            : code
              ? 'Unable to verify this code. Use a fresh authenticator code or an unused recovery code, or go back and check your password.'
              : 'Invalid email or password'
        )
        return
      }
      // Section 14.1, step 2: key setup follows at once. The password goes
      // to that page in memory, so it can offer to keep it as the passphrase.
      forgetSecrets()
      offerLegacyPassword(password)
      router.push(KEY_SETUP_PATH)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setActivity(null)
    }
  }

  async function submitPassphrase(identifier: string, passphrase: string) {
    setActivity('deriving')
    try {
      const { result, passphraseKeys } = await signInWithPassphrase({
        identifier,
        passphrase,
      })
      if (result === 'password-account' || !passphraseKeys) {
        // The account changed between the two steps.
        show({ name: 'secret', identifier, method: 'password' })
        return
      }
      if (result === 'signed-in') {
        setActivity('signing-in')
        await unlockAndFinish(passphraseKeys)
        wipePassphraseKeys(passphraseKeys)
        return
      }
      if (result === 'two-factor-required') {
        pendingKeys.current = passphraseKeys
        show({ name: 'code', identifier, method: 'passphrase' })
        return
      }
      wipePassphraseKeys(passphraseKeys)
      setError(
        result === 'passkey-required'
          ? PASSKEY_REQUIRED
          : result === 'too-many-attempts'
            ? TOO_MANY_SIGN_IN_ATTEMPTS
            : 'Invalid email or passphrase'
      )
    } catch (cause) {
      setError(
        isE2eeError(cause, 'unknown_version')
          ? 'This account uses a newer version of Flare’s encryption. Reload the page, or ask your administrator to update Flare.'
          : 'An error occurred. Please try again.'
      )
    } finally {
      setActivity(null)
    }
  }

  /** The second attempt, with a code: a new challenge and the keys in memory. No second Argon2id. */
  async function submitPassphraseCode(identifier: string, code: string) {
    const keys = pendingKeys.current
    if (!keys) {
      startOver()
      return
    }
    setActivity('signing-in')
    try {
      const result = await signInWithPassphraseKeys({
        identifier,
        passphraseKeys: keys,
        code,
      })
      if (result === 'signed-in') {
        await unlockAndFinish(keys)
        return
      }
      if (result === 'passkey-required') {
        forgetSecrets()
        setError(PASSKEY_REQUIRED)
        return
      }
      setError(
        result === 'too-many-attempts'
          ? TOO_MANY_SIGN_IN_ATTEMPTS
          : 'Unable to verify this code. Use a fresh authenticator code or an unused recovery code, or go back and check your passphrase.'
      )
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setActivity(null)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const data = new FormData(event.currentTarget)
    const text = (name: string) => (data.get(name) as string | null) ?? ''
    if (stage.name === 'passkey-recovery') return submitPasskeyRecovery(data)
    if (stage.name === 'identifier') return submitIdentifier(text('email'))
    if (stage.name === 'secret')
      return stage.method === 'passphrase'
        ? submitPassphrase(stage.identifier, text('passphrase'))
        : submitPassword(stage.identifier, text('password'))
    if (stage.method === 'passphrase')
      return submitPassphraseCode(stage.identifier, text('code'))
    if (!pendingPassword.current) return startOver()
    return submitPassword(
      stage.identifier,
      pendingPassword.current,
      text('code')
    )
  }

  const firstStep = stage.name === 'identifier'

  return (
    <form onSubmit={onSubmit} aria-busy={busy}>
      <div className="space-y-4">
        {stage.name === 'passkey-recovery' ? (
          <>
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
              <h2 className="font-medium">Recover passkey access</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Use a dedicated recovery code saved when you required passkeys.
                Each code grants full account access once with your email
                address alone. Authenticator recovery codes will not work here.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="passkey-recovery-email">Email</Label>
              <Input
                id="passkey-recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={busy}
                className="h-11"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passkey-recovery-code">
                Passkey recovery code
              </Label>
              <Input
                id="passkey-recovery-code"
                name="code"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SECURITY_CODE_MAX_LENGTH}
                required
                disabled={busy}
                data-sensitive="true"
                className="h-11 font-mono"
                placeholder="Enter an unused code"
              />
            </div>
          </>
        ) : stage.name === 'code' ? (
          <>
            <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
              <ShieldCheck
                className="h-5 w-5 text-primary"
                aria-hidden="true"
              />
              <h2 className="font-medium">Verify your identity</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {useRecoveryCode
                  ? 'Enter one of the recovery codes you saved when you enabled two-factor authentication. Each code works once.'
                  : 'Open your authenticator app and enter the six-digit code for Flare.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-code">
                {useRecoveryCode ? 'Recovery code' : 'Authenticator code'}
              </Label>
              <Input
                key={String(useRecoveryCode)}
                id="login-code"
                name="code"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                placeholder={
                  useRecoveryCode
                    ? 'Enter your recovery code'
                    : TOTP_PLACEHOLDER
                }
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                pattern={useRecoveryCode ? undefined : TOTP_CODE_PATTERN}
                maxLength={
                  useRecoveryCode ? RECOVERY_CODE_INPUT_LENGTH : TOTP_DIGITS
                }
                required
                disabled={busy}
                autoFocus
                data-sensitive="true"
                className="h-11 bg-background/50 font-mono tracking-wider"
              />
            </div>
            <button
              type="button"
              className={cn(authLinkClassName, 'text-sm', disabledLink)}
              disabled={busy}
              onClick={() => {
                setUseRecoveryCode(!useRecoveryCode)
                setError(null)
              }}
            >
              {useRecoveryCode
                ? 'Use an authenticator code'
                : 'Use a recovery code'}
            </button>
          </>
        ) : stage.name === 'secret' ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
              <span className="min-w-0 truncate" title={stage.identifier}>
                {stage.identifier}
              </span>
              <button
                type="button"
                className={cn(authLinkClassName, 'shrink-0', disabledLink)}
                disabled={busy}
                onClick={startOver}
              >
                Change
              </button>
            </div>
            {/* Password managers match the secret to this address. */}
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={stage.identifier}
              readOnly
              hidden
            />
            {stage.method === 'passphrase' ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium" htmlFor="passphrase">
                  Passphrase
                </Label>
                <Input
                  key="passphrase"
                  id="passphrase"
                  name="passphrase"
                  type="password"
                  placeholder="Enter your passphrase"
                  required
                  maxLength={PASSPHRASE_MAX_LENGTH}
                  disabled={busy}
                  className="h-11 bg-background/50 focus:bg-background transition-colors"
                  autoComplete="current-password"
                  autoFocus
                  data-sensitive="true"
                  aria-describedby="passphrase-hint"
                />
                <p
                  id="passphrase-hint"
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  Your passphrase stays in this browser. Flare checks a
                  signature made from it.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-medium" htmlFor="password">
                  Password
                </Label>
                <Input
                  key="password"
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  required
                  disabled={busy}
                  className="h-11 bg-background/50 focus:bg-background transition-colors"
                  autoComplete="current-password"
                  autoFocus
                  data-sensitive="true"
                  aria-describedby="password-hint"
                />
                <p
                  id="password-hint"
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  After this sign-in you will choose a passphrase for
                  encryption. It replaces this password.
                </p>
              </div>
            )}
            {recoveryEnabled && (
              <p className="text-right text-sm">
                <Link
                  href="/auth/forgot-password"
                  className={authLinkClassName}
                >
                  {stage.method === 'passphrase'
                    ? 'Forgot your passphrase?'
                    : 'Forgot your password?'}
                </Link>
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <Label className="text-sm font-medium" htmlFor="email">
              Email address
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="name@example.com"
              required
              maxLength={320}
              disabled={busy}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="username"
              autoFocus
            />
            {recoveryEnabled && (
              <p className="text-right text-sm">
                <Link
                  href="/auth/forgot-password"
                  className={authLinkClassName}
                >
                  Forgot your passphrase?
                </Link>
              </p>
            )}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="pt-6">
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {activity === 'deriving' ? (
            <>
              <Icons.spinner className="animate-spin" aria-hidden="true" />
              {DERIVING_KEYS}
            </>
          ) : activity === 'signing-in' ? (
            <>
              <Icons.spinner className="animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : activity === 'continue' ? (
            <>
              <Icons.spinner className="animate-spin" aria-hidden="true" />
              Checking…
            </>
          ) : stage.name === 'passkey-recovery' ? (
            'Sign in with recovery code'
          ) : stage.name === 'code' ? (
            'Verify and sign in'
          ) : stage.name === 'secret' ? (
            'Sign in'
          ) : (
            'Continue'
          )}
        </Button>
        {activity === 'deriving' && (
          <p
            role="status"
            className="mt-3 text-center text-xs leading-relaxed text-muted-foreground"
          >
            This takes a few seconds. It is what makes your passphrase slow to
            guess.
          </p>
        )}
      </div>
      {(stage.name === 'code' || stage.name === 'passkey-recovery') && (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 h-11 w-full"
          disabled={busy}
          onClick={startOver}
        >
          <ArrowLeft aria-hidden="true" />
          Back to sign in
        </Button>
      )}
      {firstStep && (passkeysSupported || oidcEnabled) && (
        <div className="space-y-3 pt-5">
          {/* The rules sit on the card itself, so the label needs no fill. */}
          <div className="flex items-center gap-3 pb-2 text-xs uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            Or
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          {passkeysSupported && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={busy}
              onClick={onPasskeySignIn}
            >
              {activity === 'passkey' ? (
                <>
                  <Icons.spinner className="animate-spin" aria-hidden="true" />
                  Waiting for your passkey…
                </>
              ) : (
                <>
                  <Fingerprint aria-hidden="true" />
                  Sign in with a passkey
                </>
              )}
            </Button>
          )}
          {oidcEnabled && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={busy}
              onClick={onOidcSignIn}
            >
              {activity === 'oidc' ? (
                <>
                  <Icons.spinner className="animate-spin" aria-hidden="true" />
                  Redirecting…
                </>
              ) : (
                oidcButtonText
              )}
            </Button>
          )}
        </div>
      )}
      {firstStep && (
        // The link keeps a full-size touch target.
        <p className="mt-2 text-center text-sm">
          <button
            type="button"
            className={cn(
              authLinkClassName,
              disabledLink,
              'inline-flex min-h-10 items-center'
            )}
            disabled={busy}
            onClick={() => {
              forgetSecrets()
              show({ name: 'passkey-recovery' })
            }}
          >
            Use a passkey recovery code
          </button>
        </p>
      )}
      <AuthFooter>
        {registrationsEnabled ? (
          <>
            New here?{' '}
            <Link href="/auth/register" className={authLinkClassName}>
              Create an account
            </Link>
          </>
        ) : (
          disabledMessage ||
          'Registration is closed. Contact your administrator for an account.'
        )}
      </AuthFooter>
    </form>
  )
}
