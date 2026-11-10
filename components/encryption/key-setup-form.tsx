'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { AlertCircle, Loader2, TriangleAlert } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import {
  DERIVING_KEYS,
  NewPassphraseFields,
  useNewPassphrase,
} from '@/components/encryption/passphrase-fields'
import { RecoveryPhrase } from '@/components/encryption/recovery-phrase'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { useAppearance } from '@/components/providers/appearance-context'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { RefusedRequest } from '@/lib/client/request'
import { setUpAccountKeys } from '@/lib/e2ee/client/api'
import { takeLegacyPassword } from '@/lib/e2ee/client/legacy-password'
import {
  wipeAccountKeys,
  wipePassphraseKeys,
} from '@/lib/e2ee/client/procedures'
import { cn } from '@/lib/utils'

import { useSignOut } from '@/hooks/use-sign-out'

/** What the page knows about the password of the sign-in that led here. */
type LegacyPassword =
  | { status: 'none' }
  | { status: 'measuring'; password: string }
  | { status: 'weak'; password: string }
  | { status: 'strong'; password: string }

const choiceClassName =
  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed transition-colors has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring'

/**
 * Key setup for a signed-in account that has no keys (docs/e2ee-spec.md,
 * section 14.1): an account from before encryption directly after its
 * password sign-in, and an account that signs in with a passkey or SSO.
 */
export function KeySetupForm() {
  const router = useRouter()
  const { state, adopt, refresh } = useAccountKeys()
  const { data: session } = useSession()
  const { brand } = useAppearance()
  const signOut = useSignOut()
  const identifier = state.status === 'setup-required' ? state.identifier : null
  const form = useNewPassphrase([identifier, session?.user?.name, brand.name])
  const { measure } = form
  const [legacy, setLegacy] = useState<LegacyPassword>({ status: 'none' })
  const [choice, setChoice] = useState<'keep' | 'new'>('keep')
  const [activity, setActivity] = useState<'deriving' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const busy = activity !== null

  useEffect(() => {
    const password = takeLegacyPassword()
    if (password) setLegacy({ status: 'measuring', password })
  }, [])

  useEffect(() => {
    if (legacy.status !== 'measuring') return
    let current = true
    const { password } = legacy
    measure(password).then(
      (strength) => {
        if (current)
          setLegacy({
            status: strength.acceptable ? 'strong' : 'weak',
            password,
          })
      },
      () => {
        if (current) setLegacy({ status: 'weak', password })
      }
    )
    return () => {
      current = false
    }
    // `measure` changes with the account's words; one measurement is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacy])

  // An account that already has keys has nothing to do here.
  const hasKeys = state.status === 'locked' || state.status === 'unlocked'
  useEffect(() => {
    // Not while this form is saving: the keys arrive a moment before the
    // recovery phrase is shown.
    if (hasKeys && !mnemonic && !busy) router.replace('/dashboard')
  }, [hasKeys, mnemonic, busy, router])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const keep = legacy.status === 'strong' && choice === 'keep'
    if (!keep && form.problem) {
      setError(form.problem)
      return
    }
    if (
      !keep &&
      legacy.status !== 'none' &&
      form.passphrase === legacy.password
    ) {
      setError(
        'That is your current password, which is too easy to guess. Choose a different passphrase.'
      )
      return
    }
    setActivity('deriving')
    try {
      const account = await setUpAccountKeys(
        keep ? legacy.password : form.passphrase
      )
      try {
        setActivity('saving')
        await adopt(account).catch(() => undefined)
        setLegacy({ status: 'none' })
        form.reset()
        setMnemonic(account.mnemonic)
      } finally {
        wipePassphraseKeys(account.passphraseKeys)
        wipeAccountKeys(account.accountKeys)
      }
    } catch (cause) {
      if (
        cause instanceof RefusedRequest &&
        cause.code === 'recent_sign_in_required'
      ) {
        setStale(true)
      } else if (
        cause instanceof RefusedRequest &&
        cause.code === 'keys_exist'
      ) {
        await refresh().catch(() => undefined)
      } else {
        setError(
          cause instanceof RefusedRequest
            ? cause.message
            : 'Unable to set up encryption. Please try again.'
        )
      }
    } finally {
      setActivity(null)
    }
  }

  if (mnemonic)
    return (
      <div className="space-y-4">
        <h2 className="text-center font-medium">
          Encryption is set up. Save your recovery phrase.
        </h2>
        <RecoveryPhrase
          mnemonic={mnemonic}
          doneLabel="Finish"
          onDone={() => {
            setMnemonic(null)
            router.push('/dashboard')
            router.refresh()
          }}
        />
      </div>
    )

  if (state.status === 'signed-out')
    return (
      <div className="space-y-5">
        <p className="text-center text-sm text-muted-foreground">
          Sign in to set up encryption for your account.
        </p>
        <Button asChild className="h-11 w-full">
          <Link href={LOCAL_SIGN_IN_PATH}>Sign in</Link>
        </Button>
      </div>
    )

  if (stale)
    return (
      <div className="space-y-5">
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            Your sign-in is more than five minutes old, so Flare did not accept
            the new passphrase. Nothing was changed. Sign in again and set it up
            right away.
          </AlertDescription>
        </Alert>
        <Button className="h-11 w-full" onClick={() => void signOut()}>
          Sign in again
        </Button>
      </div>
    )

  if (state.status !== 'setup-required' || legacy.status === 'measuring')
    return (
      <p
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking your account…
      </p>
    )

  if (!state.identifier)
    return (
      <Alert variant="warning">
        <TriangleAlert aria-hidden="true" />
        <AlertDescription>
          This account has no sign-in email address. Ask your administrator to
          add one, then sign in again to set up encryption.
        </AlertDescription>
      </Alert>
    )

  const keep = legacy.status === 'strong' && choice === 'keep'
  return (
    <form onSubmit={submit} aria-busy={busy} className="space-y-4">
      {legacy.status === 'strong' && (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">Passphrase</legend>
          <label className={choiceClassName}>
            <input
              type="radio"
              name="passphrase-choice"
              value="keep"
              checked={choice === 'keep'}
              onChange={() => setChoice('keep')}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-medium">Keep my current password</span>
              <span className="block text-muted-foreground">
                It is strong enough. It becomes your passphrase.
              </span>
            </span>
          </label>
          <label className={choiceClassName}>
            <input
              type="radio"
              name="passphrase-choice"
              value="new"
              checked={choice === 'new'}
              onChange={() => setChoice('new')}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-medium">Choose a new passphrase</span>
              <span className="block text-muted-foreground">
                The server has seen your current password. A new passphrase is
                one it never saw.
              </span>
            </span>
          </label>
        </fieldset>
      )}
      {legacy.status === 'weak' && (
        <Alert variant="warning" role="status">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            Your current password is too easy to guess to protect encrypted
            files. Choose a new passphrase.
          </AlertDescription>
        </Alert>
      )}
      {!keep && (
        <NewPassphraseFields
          form={form}
          idPrefix="key-setup"
          disabled={busy}
          inputClassName="h-11"
          label="New passphrase"
          autoFocus={legacy.status !== 'strong'}
        />
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {legacy.status === 'none'
          ? 'Your passphrase unlocks your encryption keys in this browser. It never leaves it, so nobody can reset it for you.'
          : 'From now on you sign in with this passphrase. It never leaves this browser, so nobody can reset it for you.'}{' '}
        You will get a recovery phrase next.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="h-11 w-full" disabled={busy}>
        {busy ? (
          <>
            <Icons.spinner className="animate-spin" aria-hidden="true" />
            {activity === 'deriving' ? DERIVING_KEYS : 'Saving…'}
          </>
        ) : (
          'Set up encryption'
        )}
      </Button>
      <AuthFooter>
        Signed in as{' '}
        <span className="break-all text-foreground">{state.identifier}</span>.{' '}
        <button
          type="button"
          className={cn(authLinkClassName, 'disabled:opacity-50')}
          disabled={busy}
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </AuthFooter>
    </form>
  )
}
