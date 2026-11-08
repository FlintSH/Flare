'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { AlertCircle, MailCheck, TriangleAlert } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import {
  PasswordFieldError,
  usePasswordFields,
} from '@/components/auth/password-field'
import { PasswordInput } from '@/components/auth/password-input'
import { RoleBadges } from '@/components/roles/role-badges'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import {
  ACCOUNT_PASSWORD_HELP,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from '@/lib/users/account-policy'

export function RegisterForm({
  invite,
  inviteRoles = [],
  notice,
  verificationRequired,
}: {
  invite?: string
  inviteRoles?: { id: string; name: string; color: string }[]
  notice?: string
  /** New accounts must confirm their address before using Flare. */
  verificationRequired: boolean
}) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwords = usePasswordFields({
    passwordId: 'password',
    helpId: 'password-hint',
    confirmationId: 'confirmPassword',
  })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isLoading) return
    setError(null)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string
    const name = formData.get('name') as string

    if (!passwords.validate(password, confirmPassword, event.currentTarget))
      return

    setIsLoading(true)
    try {
      const { nextAction } = await apiRequest<{ nextAction?: string }>(
        '/api/auth/register',
        {
          body: { email, password, name, ...(invite ? { invite } : {}) },
          fallback: 'Failed to register',
        }
      )

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
      setError(
        error instanceof RefusedRequest && error.code?.startsWith('invite_')
          ? `${error.message} Ask the person who invited you for a new link.`
          : error instanceof Error
            ? error.message
            : 'Something went wrong'
      )
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
          <PasswordInput
            id="password"
            name="password"
            visibilityLabel="new password"
            required
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="new-password"
            placeholder="Create a password"
            minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
            {...passwords.passwordProps}
          />
          <p id="password-hint" className="text-sm text-muted-foreground">
            {ACCOUNT_PASSWORD_HELP}
          </p>
          <PasswordFieldError
            id="password-error"
            message={passwords.errors.password}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirm password
          </Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            visibilityLabel="password confirmation"
            required
            disabled={isLoading}
            className="h-11 bg-background/50 focus:bg-background transition-colors"
            autoComplete="new-password"
            placeholder="Confirm your password"
            {...passwords.confirmationProps}
          />
          <PasswordFieldError
            id="confirmPassword-error"
            message={passwords.errors.confirmation}
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
        <Link href={SIGN_IN_PATH} className={authLinkClassName}>
          Sign in
        </Link>
      </AuthFooter>
    </form>
  )
}
