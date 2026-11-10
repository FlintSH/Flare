'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { AlertCircle, MailCheck, TriangleAlert } from 'lucide-react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import {
  DERIVING_KEYS,
  NewPassphraseFields,
  useNewPassphrase,
} from '@/components/encryption/passphrase-fields'
import { RecoveryPhrase } from '@/components/encryption/recovery-phrase'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { useAppearance } from '@/components/providers/appearance-context'
import { RoleBadges } from '@/components/roles/role-badges'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { signInWithPassphraseKeys } from '@/lib/e2ee/client/api'
import { workerArgon2id } from '@/lib/e2ee/client/argon2-worker'
import {
  createNewAccount,
  wipeAccountKeys,
  wipePassphraseKeys,
} from '@/lib/e2ee/client/procedures'
import { accountRecordToWire } from '@/lib/e2ee/client/wire'

const inputClassName =
  'h-11 bg-background/50 focus:bg-background transition-colors'

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
  const { adopt } = useAccountKeys()
  const { brand } = useAppearance()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const form = useNewPassphrase([email, name, brand.name])
  const [activity, setActivity] = useState<'deriving' | 'creating' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set once the account exists: its recovery phrase, and where to go next.
  const [created, setCreated] = useState<{
    mnemonic: string
    next: string
    signedIn: boolean
  } | null>(null)
  const isLoading = activity !== null

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isLoading) return
    setError(null)
    if (form.problem) {
      setError(form.problem)
      return
    }
    setActivity('deriving')
    try {
      // Section 5.4 of docs/e2ee-spec.md: the account record is made here.
      // The passphrase and the recovery phrase never leave this browser.
      const account = await createNewAccount({
        passphrase: form.passphrase,
        argon2id: workerArgon2id,
      })
      try {
        setActivity('creating')
        const { nextAction } = await apiRequest<{ nextAction?: string }>(
          '/api/auth/register',
          {
            body: {
              email,
              name,
              account: accountRecordToWire(account.record),
              ...(invite ? { invite } : {}),
            },
            fallback: 'Failed to register',
          }
        )
        // The keys are in memory: sign in and keep them without a second
        // derivation. If the sign-in fails the account still exists, so the
        // recovery phrase is shown either way.
        const signedIn =
          (await signInWithPassphraseKeys({
            identifier: email,
            passphraseKeys: account.passphraseKeys,
          }).catch(() => 'refused')) === 'signed-in'
        if (signedIn) await adopt(account).catch(() => undefined)
        form.reset()
        setCreated({
          mnemonic: account.mnemonic,
          signedIn,
          next: !signedIn
            ? SIGN_IN_PATH
            : nextAction === 'verify_email'
              ? '/auth/verify-email'
              : '/dashboard',
        })
      } finally {
        wipePassphraseKeys(account.passphraseKeys)
        wipeAccountKeys(account.accountKeys)
      }
    } catch (error) {
      setError(
        error instanceof RefusedRequest && error.code?.startsWith('invite_')
          ? `${error.message} Ask the person who invited you for a new link.`
          : error instanceof RefusedRequest
            ? error.message
            : 'Something went wrong. Please try again.'
      )
    } finally {
      setActivity(null)
    }
  }

  if (created)
    return (
      <div className="space-y-4">
        <h2 className="text-center font-medium">
          Your account is ready. Save your recovery phrase.
        </h2>
        {!created.signedIn && (
          <Alert variant="warning" role="status">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>
              We could not sign you in automatically. Save the phrase, then sign
              in with your new passphrase.
            </AlertDescription>
          </Alert>
        )}
        <RecoveryPhrase
          mnemonic={created.mnemonic}
          doneLabel={created.signedIn ? 'Finish' : 'Go to sign in'}
          onDone={() => {
            const { next } = created
            setCreated(null)
            router.push(next)
            router.refresh()
          }}
        />
      </div>
    )

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
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a username"
            required
            disabled={isLoading}
            className={inputClassName}
            autoComplete="nickname"
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
            disabled={isLoading}
            className={inputClassName}
            autoComplete="username"
          />
        </div>
        <NewPassphraseFields
          form={form}
          idPrefix="register"
          disabled={isLoading}
          inputClassName={inputClassName}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your passphrase signs you in and locks your encryption keys. It never
          leaves this browser, so nobody can reset it for you. You will get a
          recovery phrase next.
        </p>
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
              {activity === 'deriving' ? DERIVING_KEYS : 'Creating account…'}
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
