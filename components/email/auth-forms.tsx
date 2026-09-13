'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { AccountEmail, useAccountEmailStatus } from './account-email'
import { EmailCapabilities, emailPost, emailRequest } from './api'

function Feedback({ error, message }: { error: string; message: string }) {
  return (
    <div aria-live="polite">
      {error && (
        <p
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && <p className="rounded-md border p-3 text-sm">{message}</p>}
    </div>
  )
}

export function ForgotPasswordForm() {
  const [capabilities, setCapabilities] = useState<EmailCapabilities | null>(
    null
  )
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    emailRequest<EmailCapabilities>('/api/auth/email/capabilities')
      .then(setCapabilities)
      .catch(() =>
        setError(
          'Unable to check whether recovery is available. Please try again later.'
        )
      )
  }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await emailPost<{ message: string }>(
        '/api/auth/email/request-reset',
        { email }
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
      {capabilities?.enabled && capabilities.recoveryEnabled ? (
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="recovery-email">Email address</Label>
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? 'Requesting…' : 'Send reset link'}
          </Button>
        </form>
      ) : capabilities ? (
        <p className="text-sm text-muted-foreground">
          Email password recovery is not enabled on this instance. Contact your
          administrator for help.
        </p>
      ) : (
        !error && (
          <p className="text-sm text-muted-foreground">
            Checking recovery options…
          </p>
        )
      )}
      <Feedback error={error} message={message} />
      <Link
        href="/auth/login?local=1"
        className="block text-sm text-primary hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (data.get('password') !== data.get('confirmPassword')) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await emailPost<{ message: string }>(
        '/api/auth/email/reset',
        { token, password: data.get('password') }
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
      {!token ? (
        <p className="text-sm">
          This reset link is incomplete. Request a new link below.
        </p>
      ) : (
        !complete && (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                Use at least 8 characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm">Confirm new password</Label>
              <Input
                id="reset-confirm"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                disabled={busy}
              />
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Reset password'}
            </Button>
          </form>
        )
      )}
      <Feedback error={error} message={message} />
      {!complete && (
        <Link
          href="/auth/forgot-password"
          className="block text-sm text-primary hover:underline"
        >
          Request a new reset link
        </Link>
      )}
      <Link
        href="/auth/login?local=1"
        className="block text-sm text-primary hover:underline"
      >
        Back to sign in
      </Link>
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
      const result = await emailPost<{ message: string }>(
        '/api/auth/email/verify',
        { token }
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
            className="w-full"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Confirming…' : 'Confirm email'}
          </Button>
        </>
      )}
      <Feedback error={error} message={message} />
      {complete ? (
        <Link
          href="/dashboard"
          className="block text-sm text-primary hover:underline"
        >
          Continue to Flare
        </Link>
      ) : (
        <Link
          href="/auth/verify-email"
          className="block text-sm text-primary hover:underline"
        >
          Check status or request another email
        </Link>
      )}
      <Link
        href="/auth/login?local=1"
        className="block text-sm text-primary hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  )
}

function VerificationStatus() {
  const { status, error, refresh } = useAccountEmailStatus()
  if (error)
    return (
      <div className="space-y-4">
        <p className="text-sm" role="alert">
          {error}
        </p>
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          Try again
        </Button>
        <Link
          className="block text-sm text-primary hover:underline"
          href="/auth/login?local=1"
        >
          Sign in
        </Link>
      </div>
    )
  if (!status)
    return (
      <p className="text-sm text-muted-foreground">
        Checking your email status…
      </p>
    )
  if (!status.enabled)
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Email verification is not enabled on this instance.
        </p>
        <Link
          href="/dashboard"
          className="text-sm text-primary hover:underline"
        >
          Continue to Flare
        </Link>
      </div>
    )
  if (status.verified)
    return (
      <div className="space-y-3">
        <p className="text-sm">Your email address is verified.</p>
        <Link
          href="/dashboard"
          className="text-sm text-primary hover:underline"
        >
          Continue to Flare
        </Link>
      </div>
    )
  return <AccountEmail status={status} refresh={refresh} restricted />
}
