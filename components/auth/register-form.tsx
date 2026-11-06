'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { AlertCircle, MailCheck, TriangleAlert } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import { EmailCapabilities, emailRequest } from '@/components/email/api'
import { RoleBadges } from '@/components/roles/role-badges'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { ACCOUNT_PASSWORD_MIN_LENGTH } from '@/lib/users/account-policy'

export function RegisterForm({
  invite,
  inviteRoles = [],
  notice,
}: {
  invite?: string
  inviteRoles?: { id: string; name: string; color: string }[]
  notice?: string
}) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verificationRequired, setVerificationRequired] = useState(false)

  useEffect(() => {
    emailRequest<EmailCapabilities>('/api/auth/email/capabilities')
      .then((email) =>
        setVerificationRequired(
          email.enabled &&
            ['new_users', 'all_users'].includes(email.verificationMode)
        )
      )
      .catch(() => {})
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string
    const name = formData.get('name') as string

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
      setError(
        `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters long`
      )
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          name,
          ...(invite ? { invite } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          typeof data.code === 'string' && data.code.startsWith('invite_')
            ? `${data.error} Ask the person who invited you for a new link.`
            : data.error || 'Failed to register'
        )
      }

      const registered = await res.json()
      const nextAction = (registered.data ?? registered).nextAction

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        throw new Error('Failed to sign in after registration')
      }

      router.push(
        nextAction === 'verify_email' ? '/auth/verify-email' : '/dashboard'
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} aria-busy={isLoading}>
      {notice && (
        <Alert variant="warning" role="status" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {inviteRoles.length > 0 && (
        <div className="mb-4 space-y-2 rounded-xl border bg-muted/30 p-3 text-sm">
          <p className="text-muted-foreground">You’ll join with these roles:</p>
          <RoleBadges roles={inviteRoles} />
        </div>
      )}
      {verificationRequired && (
        <Alert variant="info" role="status" className="mb-4">
          <MailCheck aria-hidden="true" />
          <AlertDescription>
            We’ll ask you to confirm your email before using your account.
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium" htmlFor="name">
            Username
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="Create a username"
            required
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="username"
            autoFocus
          />
        </div>
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
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="email"
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
            required
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="new-password"
            placeholder="Create a password"
            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            {`Use at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`}
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirm password
          </Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="new-password"
            placeholder="Confirm your password"
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="pt-6">
        <Button type="submit" className="h-11 w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Icons.spinner className="animate-spin" aria-hidden="true" />
              Creating account…
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </div>
      <AuthFooter>
        Already have an account?{' '}
        <Link href="/auth/login" className={authLinkClassName}>
          Sign in
        </Link>
      </AuthFooter>
    </form>
  )
}
