'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
} from 'lucide-react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import {
  PasswordFieldError,
  usePasswordFields,
} from '@/components/auth/password-field'
import { PasswordInput } from '@/components/auth/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { apiRequest } from '@/lib/client/request'
import {
  ACCOUNT_PASSWORD_HELP,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from '@/lib/users/account-policy'

import { AccountEmail, useAccountEmailStatus } from './account-email'
import { fetchEmailCapabilities } from './api'

function Feedback({ error, message }: { error: string; message: string }) {
  return (
    <div aria-live="polite" className="space-y-3 empty:sr-only">
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert variant="success" role="status">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function useRecoveryAvailability(known: boolean | null) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (known !== null) return
    let active = true
    fetchEmailCapabilities()
      .then((value) => {
        if (active) setAvailable(value.recoveryEnabled)
      })
      .catch(() => {
        if (active)
          setFailure('Unable to check whether password recovery is available.')
      })
    return () => {
      active = false
    }
  }, [known, attempt])
  return {
    available: known ?? available,
    failure,
    retry() {
      setFailure('')
      setAttempt((value) => value + 1)
    },
  }
}

function RecoveryUnavailable() {
  return (
    <Alert variant="info" role="status">
      <Info aria-hidden="true" />
      <AlertDescription>
        Email password recovery is not enabled on this instance. Contact the
        person who provided or manages your account.
      </AlertDescription>
    </Alert>
  )
}

function RecoveryCheck({
  failure,
  retry,
}: {
  failure: string
  retry: () => void
}) {
  return failure ? (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">
        {failure}
      </p>
      <Button type="button" variant="outline" onClick={retry}>
        Check again
      </Button>
    </div>
  ) : (
    <p
      className="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Checking recovery options…
    </p>
  )
}

/** `recoveryEnabled` is the page's answer; without one, the browser asks. */
export function ForgotPasswordForm({
  recoveryEnabled: known = null,
}: {
  recoveryEnabled?: boolean | null
}) {
  const {
    available: recoveryEnabled,
    failure,
    retry,
  } = useRecoveryAvailability(known)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await apiRequest<{ message: string }>(
        '/api/auth/email/request-reset',
        { body: { email } }
      )
      setMessage(result.message)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to request a password reset.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      {recoveryEnabled ? (
        <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email address</Label>
            <Input
              className="h-11"
              id="recovery-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <Button className="h-11 w-full" type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Send reset link'}
          </Button>
        </form>
      ) : recoveryEnabled === false ? (
        <RecoveryUnavailable />
      ) : (
        <RecoveryCheck failure={failure} retry={retry} />
      )}
      <Feedback error={error} message={message} />
      <AuthFooter>
        <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
          Back to sign in
        </Link>
      </AuthFooter>
    </div>
  )
}

export function ResetPasswordForm({
  token,
  recoveryEnabled: known = null,
}: {
  token: string
  recoveryEnabled?: boolean | null
}) {
  const {
    available: recoveryEnabled,
    failure,
    retry,
  } = useRecoveryAvailability(known)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const passwords = usePasswordFields({
    passwordId: 'reset-password',
    helpId: 'reset-password-help',
    confirmationId: 'reset-confirm',
  })
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const password = data.get('password') as string
    if (
      !passwords.validate(
        password,
        data.get('confirmPassword') as string,
        event.currentTarget
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ message: string }>(
        '/api/auth/email/reset',
        { body: { token, password } }
      )
      setComplete(true)
      setMessage(
        result.message || 'Password updated. Sign in with your new password.'
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to reset your password.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      {!complete && recoveryEnabled === false ? (
        <RecoveryUnavailable />
      ) : !complete && recoveryEnabled === null ? (
        <RecoveryCheck failure={failure} retry={retry} />
      ) : !token ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            This reset link is incomplete. Request a new link below.
          </AlertDescription>
        </Alert>
      ) : (
        !complete && (
          <form className="space-y-4" onSubmit={submit} aria-busy={busy}>
            <div className="space-y-2">
              <Label htmlFor="reset-password">New password</Label>
              <PasswordInput
                className="h-11"
                id="reset-password"
                name="password"
                visibilityLabel="new password"
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                {...passwords.passwordProps}
                required
                disabled={busy}
              />
              <p
                id="reset-password-help"
                className="text-sm text-muted-foreground"
              >
                {ACCOUNT_PASSWORD_HELP}
              </p>
              <PasswordFieldError
                id="reset-password-error"
                message={passwords.errors.password}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm">Confirm new password</Label>
              <PasswordInput
                className="h-11"
                id="reset-confirm"
                name="confirmPassword"
                visibilityLabel="new password confirmation"
                autoComplete="new-password"
                minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                required
                disabled={busy}
                {...passwords.confirmationProps}
              />
              <PasswordFieldError
                id="reset-confirm-error"
                message={passwords.errors.confirmation}
              />
            </div>
            <Button className="h-11 w-full" type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Reset password'}
            </Button>
          </form>
        )
      )}
      <Feedback error={error} message={message} />
      {complete ? (
        <Button asChild className="h-11 w-full">
          <Link href={LOCAL_SIGN_IN_PATH}>Sign in with your new password</Link>
        </Button>
      ) : (
        <AuthFooter>
          {recoveryEnabled !== false && (
            <>
              <Link href="/auth/forgot-password" className={authLinkClassName}>
                {recoveryEnabled
                  ? 'Request a new reset link'
                  : 'Check recovery options'}
              </Link>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
            Back to sign in
          </Link>
        </AuthFooter>
      )}
    </div>
  )
}

export function VerifyEmailForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ message: string }>(
        '/api/auth/email/verify',
        { body: { token } }
      )
      setMessage(result.message || 'Email confirmed.')
      setComplete(true)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to confirm your email.'
      )
    } finally {
      setBusy(false)
    }
  }
  if (!token) return <VerificationStatus />
  return (
    <div className="space-y-5">
      {!complete && (
        <>
          <p className="text-sm text-muted-foreground">
            Confirm the email verification or address change that you requested.
            If you did not request this, you can close this page.
          </p>
          <Button
            className="h-11 w-full"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Confirming…' : 'Confirm email'}
          </Button>
        </>
      )}
      <Feedback error={error} message={message} />
      {complete ? (
        <Button asChild className="h-11 w-full">
          <Link href="/dashboard">
            Go to your files
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      <AuthFooter>
        {!complete && (
          <>
            <Link href="/auth/verify-email" className={authLinkClassName}>
              Check status or request another email
            </Link>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
          Back to sign in
        </Link>
      </AuthFooter>
    </div>
  )
}

function VerificationStatus() {
  const { status, error, refresh } = useAccountEmailStatus()
  if (error)
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => void refresh()}
        >
          Try again
        </Button>
        <AuthFooter>
          <Link className={authLinkClassName} href={LOCAL_SIGN_IN_PATH}>
            Sign in
          </Link>
        </AuthFooter>
      </div>
    )
  if (!status)
    return (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking your email status…
      </p>
    )
  if (!status.enabled)
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Email verification is not enabled on this instance.
        </p>
        <Button asChild className="h-11 w-full">
          <Link href="/dashboard">
            Go to your files
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    )
  if (status.verified)
    return (
      <div className="space-y-3">
        <Feedback error="" message="Your email address is verified." />
        <Button asChild className="h-11 w-full">
          <Link href="/dashboard">
            Go to your files
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    )
  return <AccountEmail status={status} refresh={refresh} restricted />
}
