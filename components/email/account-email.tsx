'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { signOut } from 'next-auth/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { AccountEmailStatus, emailPost, emailRequest } from './api'

export function useAccountEmailStatus() {
  const [status, setStatus] = useState<AccountEmailStatus | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      setStatus(
        await emailRequest<AccountEmailStatus>('/api/auth/email/status')
      )
      setError('')
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to load your email status.'
      )
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { status, error, refresh }
}

export function AccountEmail({
  status,
  email,
  refresh,
  restricted = false,
}: {
  status: AccountEmailStatus
  email?: string | null
  refresh: () => Promise<void>
  restricted?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [changeOpen, setChangeOpen] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const canChange =
    status.canChangeEmail && (!status.requiresOldEmail || status.verified)

  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(
      () => setCooldown((seconds) => Math.max(0, seconds - 1)),
      1000
    )
    return () => clearTimeout(timer)
  }, [cooldown])

  const action = async (path: string, body: unknown) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await emailPost<{ message: string }>(
        `/api/auth/email/${path}`,
        body
      )
      setMessage(result.message)
      setPassword('')
      if (path === 'enroll' || path === 'resend')
        setCooldown(status.resendSeconds || 60)
      await refresh()
      router.refresh()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to update your email.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (!status.enabled) return null
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h3 className="font-medium">Email address</h3>
        {email && <p className="break-all text-sm">{email}</p>}
        <p className="text-sm text-muted-foreground">
          {status.verified
            ? 'Email address verified.'
            : status.required
              ? 'Verify your email address to continue using Flare.'
              : status.exempt
                ? 'Your account can continue without verification. Confirm your address to prove that you own it.'
                : 'Your email address has not been verified.'}
        </p>
      </div>
      {!status.verified &&
        !status.exempt &&
        !status.required &&
        status.verificationMode === 'all_users' &&
        status.graceEndsAt && (
          <p className="text-sm text-muted-foreground">
            Verify by {new Date(status.graceEndsAt).toLocaleString()} to keep
            access to your account.
          </p>
        )}
      {!status.verified && status.canEnroll && !status.canResend && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void action('enroll', { password })
          }}
        >
          <p className="text-sm text-muted-foreground">
            {status.requiresPassword
              ? 'Confirm your current password. We will send a link to verify that you own this address.'
              : 'Confirm this address with an email link. You may need to sign in with SSO again if your last sign-in was more than a few minutes ago.'}
          </p>
          {status.requiresPassword && (
            <>
              <Label htmlFor="email-enroll-password">Current password</Label>
              <Input
                id="email-enroll-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Verify my email'}
          </Button>
        </form>
      )}
      {!status.verified && status.canResend && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Check your inbox and spam folder. Allow a little time for delivery
            before requesting another email.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || cooldown > 0}
            onClick={() => void action('resend', {})}
          >
            {busy
              ? 'Sending…'
              : cooldown > 0
                ? `Resend available in ${cooldown}s`
                : 'Resend verification email'}
          </Button>
        </div>
      )}
      {status.pendingEmail && (
        <div className="space-y-2 rounded-md bg-muted/30 p-3">
          <p className="text-sm">
            Waiting for confirmation of{' '}
            <span className="font-medium break-all">{status.pendingEmail}</span>
            . Your current email stays active until the change is approved.
          </p>
          {status.requiresOldEmail && (
            <p className="text-sm text-muted-foreground">
              Check both your current and new inboxes for confirmation links.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void action('cancel-change', {})}
          >
            Cancel pending change
          </Button>
        </div>
      )}
      {status.canChangeEmail && !canChange && (
        <p className="text-sm text-muted-foreground">
          This instance requires your current address to be verified before it
          can be changed. Contact your administrator if you cannot access that
          inbox.
        </p>
      )}
      {canChange && !status.pendingEmail && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setChangeOpen(!changeOpen)
            setPassword('')
          }}
        >
          {changeOpen ? 'Cancel' : 'Change email address'}
        </Button>
      )}
      {changeOpen && canChange && !status.pendingEmail && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void action('change', { email: newEmail, password })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email-new-address">New email address</Label>
            <Input
              id="email-new-address"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              required
              disabled={busy}
            />
          </div>
          {status.requiresPassword && (
            <div className="space-y-2">
              <Label htmlFor="email-change-password">Current password</Label>
              <Input
                id="email-change-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {status.requiresOldEmail
              ? 'We will send approval links to your current and new addresses.'
              : 'Your current email remains active until you confirm the new address.'}
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send confirmation'}
          </Button>
        </form>
      )}
      <div aria-live="polite" className="space-y-2">
        {message && <p className="text-sm">{message}</p>}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {restricted && (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              await refresh()
              router.refresh()
              router.push('/dashboard')
            }}
          >
            I have verified my email
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void signOut({ callbackUrl: '/auth/login' })}
          >
            Sign out
          </Button>
        </div>
      )}
    </div>
  )
}
