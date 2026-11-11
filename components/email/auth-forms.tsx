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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { apiRequest } from '@/lib/client/request'

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

/** `recoveryEnabled` is the page's answer; without one, the browser asks. */
export function ForgotPasswordForm({
  recoveryEnabled: known = null,
}: {
  recoveryEnabled?: boolean | null
}) {
  const [recoveryEnabled, setRecoveryEnabled] = useState(known)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (known !== null) return
    fetchEmailCapabilities()
      .then((capabilities) => setRecoveryEnabled(capabilities.recoveryEnabled))
      .catch(() =>
        setError(
          'Unable to check whether recovery is available. Please try again later.'
        )
      )
  }, [known])
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
          : 'Unable to request a reset link.'
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            The link lets you choose a new passphrase. Have your recovery phrase
            ready: without it, files that the account encrypted cannot be opened
            again.
          </p>
          <Button className="h-11 w-full" type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Send reset link'}
          </Button>
        </form>
      ) : recoveryEnabled === false ? (
        <Alert variant="info" role="status">
          <Info aria-hidden="true" />
          <AlertDescription>
            Recovery by email is not enabled on this instance. Contact your
            administrator for help.
          </AlertDescription>
        </Alert>
      ) : (
        !error && (
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking recovery options…
          </p>
        )
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
