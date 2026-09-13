'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import { EmailCapabilities, emailPost, emailRequest } from './api'

interface UserEmailState {
  verified: boolean
  exempt: boolean
  required: boolean
  pendingEmail: string | null
}

export function UserEmailControls({ userId }: { userId: string }) {
  const [status, setStatus] = useState<UserEmailState | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    const result = await emailRequest<UserEmailState>(
      `/api/users/${encodeURIComponent(userId)}/email`
    )
    setStatus(result)
  }, [userId])
  useEffect(() => {
    let active = true
    emailRequest<EmailCapabilities>('/api/auth/email/capabilities')
      .then(async (capabilities) => {
        if (!active || !capabilities.enabled) return
        setEnabled(true)
        await refresh()
      })
      .catch(() => {
        if (active) setError('Unable to load email controls.')
      })
    return () => {
      active = false
    }
  }, [refresh])
  const action = async (value: 'exempt' | 'require' | 'resend') => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await emailPost<{ message: string }>(
        `/api/users/${encodeURIComponent(userId)}/email`,
        { action: value }
      )
      setMessage(result.message)
      await refresh()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to update email policy.'
      )
    } finally {
      setBusy(false)
    }
  }
  if (!enabled) return null
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium text-sm">Email verification</h3>
      {status ? (
        <>
          <p className="text-sm text-muted-foreground">
            {status.verified ? 'Address verified.' : 'Address not verified.'}{' '}
            {status.exempt
              ? 'Exempt from required verification.'
              : status.required
                ? 'Verification is required.'
                : 'Following the instance policy.'}
          </p>
          {status.pendingEmail && (
            <p className="text-sm break-all">
              Pending change: {status.pendingEmail}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void action(status.exempt ? 'require' : 'exempt')}
            >
              {status.exempt
                ? 'Follow instance policy'
                : 'Exempt from requirement'}
            </Button>
            {!status.verified && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void action('resend')}
              >
                Send verification
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Exempting an account preserves access without verifying its address.
            Users with older, unconfirmed addresses must enroll from their own
            profile before using email recovery.
          </p>
        </>
      ) : (
        !error && (
          <p className="text-sm text-muted-foreground">Loading email status…</p>
        )
      )}
      <div aria-live="polite">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {message && <p className="text-sm">{message}</p>}
      </div>
    </div>
  )
}
