'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { ArrowLeft, Fingerprint, ShieldCheck } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { passkeyError, securityRequest } from '@/components/auth/security-api'
import { EmailCapabilities, emailRequest } from '@/components/email/api'
import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getOidcErrorMessage } from '@/lib/auth/oidc-error-messages'
import { getSetupResumePath } from '@/lib/setup/navigation'

interface LoginFormProps {
  registrationsEnabled: boolean
  disabledMessage: string
  oidcEnabled?: boolean
  oidcButtonText?: string
}

export function LoginForm({
  registrationsEnabled,
  disabledMessage,
  oidcEnabled = false,
  oidcButtonText = 'Sign in with SSO',
}: Readonly<LoginFormProps>) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<
    'password' | 'passkey' | 'oidc' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [recoveryEnabled, setRecoveryEnabled] = useState(false)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  // Credentials stay in memory only while completing the second factor.
  const pendingCredentials = useRef<{ email: string; password: string } | null>(
    null
  )
  const busy = loading !== null

  useEffect(() => {
    setPasskeysSupported(window.isSecureContext && !!window.PublicKeyCredential)
    emailRequest<EmailCapabilities>('/api/auth/email/capabilities')
      .then((email) =>
        setRecoveryEnabled(email.enabled && email.recoveryEnabled)
      )
      .catch(() => {})
    return () => {
      pendingCredentials.current = null
    }
  }, [])

  useEffect(() => {
    const errorCode = searchParams.get('error')
    if (errorCode) setError(getOidcErrorMessage(errorCode))
  }, [searchParams])

  function finishSignIn() {
    pendingCredentials.current = null
    // Only allow these fixed callbacks on the current origin.
    router.push(
      searchParams.get('setupEmail') === '1'
        ? getSetupResumePath(searchParams.get('setupStep'))
        : '/dashboard'
    )
    router.refresh()
  }

  async function onOidcSignIn() {
    setLoading('oidc')
    setError(null)
    try {
      await signIn('oidc', { callbackUrl: '/dashboard' })
    } catch {
      setError('Unable to start sign-in. Please try again.')
      setLoading(null)
    }
  }

  async function onPasskeySignIn() {
    setLoading('passkey')
    setError(null)
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const { options, challengeId } = await securityRequest<{
        options: PublicKeyCredentialRequestOptionsJSON
        challengeId: string
      }>('/api/auth/passkeys/options', {})
      const assertion = await startAuthentication({ optionsJSON: options })
      const result = await signIn('passkey', {
        challengeId,
        response: JSON.stringify(assertion),
        redirect: false,
        callbackUrl: '/dashboard',
      })
      if (!result || result.error) {
        setError(
          result?.error === 'TooManyAttempts'
            ? 'Too many sign-in attempts. Wait 15 minutes before trying again.'
            : 'Unable to sign in with this passkey. Try again or use your password.'
        )
        return
      }
      finishSignIn()
    } catch (cause) {
      setError(passkeyError(cause))
    } finally {
      setLoading(null)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setLoading('password')
    setError(null)
    const data = new FormData(event.currentTarget)
    const credentials = twoFactorRequired
      ? pendingCredentials.current
      : {
          email: data.get('email') as string,
          password: data.get('password') as string,
        }
    if (!credentials) {
      setTwoFactorRequired(false)
      setLoading(null)
      return
    }

    try {
      const result = await signIn('credentials', {
        ...credentials,
        ...(twoFactorRequired ? { code: data.get('code') } : {}),
        redirect: false,
        callbackUrl: '/dashboard',
      })
      if (result?.error === 'TwoFactorRequired') {
        pendingCredentials.current = credentials
        setTwoFactorRequired(true)
        return
      }
      if (!result || result.error) {
        setError(
          result?.error === 'TooManyAttempts'
            ? 'Too many sign-in attempts. Wait 15 minutes before trying again.'
            : twoFactorRequired
              ? 'Unable to verify this code. Use a fresh authenticator code or an unused recovery code, or go back and check your password.'
              : 'Invalid email or password'
        )
        return
      }
      finishSignIn()
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <form onSubmit={onSubmit} aria-busy={busy}>
      <div className="space-y-4">
        {twoFactorRequired ? (
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
                  useRecoveryCode ? 'Enter your recovery code' : '000000'
                }
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                pattern={useRecoveryCode ? undefined : '[0-9]{6}'}
                maxLength={useRecoveryCode ? 32 : 6}
                required
                disabled={busy}
                autoFocus
                data-sensitive="true"
                className="h-11 bg-background/50 font-mono tracking-wider"
              />
            </div>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm"
              disabled={busy}
              onClick={() => {
                setUseRecoveryCode(!useRecoveryCode)
                setError(null)
              }}
            >
              {useRecoveryCode
                ? 'Use an authenticator code'
                : 'Use a recovery code'}
            </Button>
          </>
        ) : (
          <>
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
                disabled={busy}
                className="h-11 bg-background/50 focus:bg-background transition-colors"
                autoComplete="email"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium" htmlFor="password">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                required
                disabled={busy}
                className="h-11 bg-background/50 focus:bg-background transition-colors"
                autoComplete="current-password"
                data-sensitive="true"
              />
              {recoveryEnabled && (
                <Link
                  href="/auth/forgot-password"
                  className="block text-right text-sm text-primary hover:underline"
                >
                  Forgot your password?
                </Link>
              )}
            </div>
          </>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-foreground"
          >
            <Icons.alertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="pt-6">
        <Button
          type="submit"
          className="w-full h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
          disabled={busy}
        >
          {loading === 'password' ? (
            <>
              <Icons.spinner
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              Signing in...
            </>
          ) : twoFactorRequired ? (
            'Verify and sign in'
          ) : (
            'Sign in'
          )}
        </Button>
      </div>
      {twoFactorRequired && (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => {
            pendingCredentials.current = null
            setTwoFactorRequired(false)
            setUseRecoveryCode(false)
            setError(null)
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Button>
      )}
      {!twoFactorRequired && (passkeysSupported || oidcEnabled) && (
        <div className="pt-6 space-y-3">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-3 text-muted-foreground">Or</span>
            </div>
          </div>
          {passkeysSupported && (
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 font-medium"
              disabled={busy}
              onClick={onPasskeySignIn}
            >
              {loading === 'passkey' ? (
                <>
                  <Icons.spinner
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Waiting for your passkey…
                </>
              ) : (
                <>
                  <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
                  Sign in with a passkey
                </>
              )}
            </Button>
          )}
          {oidcEnabled && (
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 font-medium"
              disabled={busy}
              onClick={onOidcSignIn}
            >
              {loading === 'oidc' ? (
                <>
                  <Icons.spinner
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Redirecting...
                </>
              ) : (
                oidcButtonText
              )}
            </Button>
          )}
        </div>
      )}
      <div className="mt-6 border-t border-border/60 pt-5 text-center text-sm leading-relaxed text-muted-foreground">
        {registrationsEnabled ? (
          <>
            New here?{' '}
            <Link
              href="/auth/register"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Create an account
            </Link>
          </>
        ) : (
          disabledMessage ||
          'Registration is closed. Contact your administrator for an account.'
        )}
      </div>
    </form>
  )
}
