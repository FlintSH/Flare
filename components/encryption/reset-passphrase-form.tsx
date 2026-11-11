'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  AlertCircle,
  ArrowLeft,
  FileKey2,
  Loader2,
  ShieldOff,
  TriangleAlert,
} from 'lucide-react'

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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { RefusedRequest } from '@/lib/client/request'
import {
  type ResetLink,
  checkRecoveryPhrase,
  readResetLink,
  recoverWithRecoveryPhrase,
  resetWithEmailLink,
} from '@/lib/e2ee/client/api'
import { isE2eeError } from '@/lib/e2ee/errors'

/**
 * The one step that the page shows. An account that has keys chooses between
 * recovery with its recovery phrase (docs/e2ee-spec.md, section 6.8) and a
 * reset without it (section 6.9). An account from before encryption has no
 * keys yet and only chooses a passphrase.
 */
type Step =
  | { name: 'loading' }
  | { name: 'unusable'; message: string }
  | { name: 'choose' }
  | { name: 'phrase' }
  | { name: 'recover'; mnemonic: string }
  | { name: 'reset'; hadKeys: boolean }
  | { name: 'done'; mnemonic: string }

const choiceClassName =
  'flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-relaxed transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function failure(cause: unknown, fallback: string) {
  if (isE2eeError(cause, 'unknown_version'))
    return 'This account uses a newer version of Flare’s encryption. Reload the page, or ask your administrator to update Flare.'
  return cause instanceof RefusedRequest || cause instanceof Error
    ? cause.message || fallback
    : fallback
}

export function ResetPassphraseForm({ token }: { token: string }) {
  const router = useRouter()
  const { lock } = useAccountKeys()
  const { brand } = useAppearance()
  // The link does not say whose account it is, so the instance name is the
  // only word that the strength check can rule out.
  const form = useNewPassphrase([brand.name])
  const [step, setStep] = useState<Step>({ name: 'loading' })
  const [link, setLink] = useState<ResetLink | null>(null)
  const [phrase, setPhrase] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    readResetLink(token, controller.signal).then(
      (answer) => {
        setLink(answer)
        setStep(
          answer.hasKeys
            ? { name: 'choose' }
            : { name: 'reset', hadKeys: false }
        )
      },
      (cause) => {
        if (controller.signal.aborted) return
        setStep({
          name: 'unusable',
          message: failure(cause, 'Unable to check this reset link.'),
        })
      }
    )
    return () => controller.abort()
  }, [token])

  function show(next: Step) {
    setError(null)
    setStep(next)
  }

  function checkPhrase(event: React.FormEvent) {
    event.preventDefault()
    if (!link?.hasKeys) return
    setError(null)
    try {
      checkRecoveryPhrase(phrase, link)
    } catch (cause) {
      setError(
        isE2eeError(cause, 'key_mismatch')
          ? 'This is a valid recovery phrase, but not the current one of this account. Changing a passphrase replaces the recovery phrase: use the newest one you saved.'
          : 'That is not a recovery phrase. Check the spelling and the order: it has 24 words.'
      )
      return
    }
    const mnemonic = phrase
    setPhrase('')
    show({ name: 'recover', mnemonic })
  }

  async function submitNewPassphrase(event: React.FormEvent) {
    event.preventDefault()
    if (busy || (step.name !== 'recover' && step.name !== 'reset')) return
    setError(null)
    if (step.name === 'reset' && step.hadKeys && !understood) {
      setError('Confirm that you understand what a reset does.')
      return
    }
    if (form.problem) {
      setError(form.problem)
      return
    }
    setBusy(true)
    try {
      const result =
        step.name === 'recover'
          ? await recoverWithRecoveryPhrase({
              token,
              mnemonic: step.mnemonic,
              newPassphrase: form.passphrase,
            })
          : await resetWithEmailLink({ token, newPassphrase: form.passphrase })
      // Keys of the old account record in this browser open nothing new.
      await lock().catch(() => undefined)
      form.reset()
      show({ name: 'done', mnemonic: result.mnemonic })
    } catch (cause) {
      setError(
        isE2eeError(cause)
          ? 'This recovery phrase no longer matches the account. Start again.'
          : failure(cause, 'Unable to reset your passphrase.')
      )
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <AuthFooter>
      <Link href="/auth/forgot-password" className={authLinkClassName}>
        Request a new reset link
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
        Back to sign in
      </Link>
    </AuthFooter>
  )
  const errorAlert = error && (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )

  if (step.name === 'loading')
    return (
      <p
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking your reset link…
      </p>
    )

  if (step.name === 'unusable')
    return (
      <div className="space-y-5">
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{step.message}</AlertDescription>
        </Alert>
        <Button asChild className="h-11 w-full">
          <Link href="/auth/forgot-password">Request a new link</Link>
        </Button>
        <AuthFooter>
          <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
            Back to sign in
          </Link>
        </AuthFooter>
      </div>
    )

  if (step.name === 'done')
    return (
      <div className="space-y-4">
        <h2 className="text-center font-medium">
          Your passphrase is set. Save your new recovery phrase.
        </h2>
        <RecoveryPhrase
          mnemonic={step.mnemonic}
          replacesOld={!!link?.hasKeys}
          doneLabel="Go to sign in"
          onDone={() => router.push(LOCAL_SIGN_IN_PATH)}
        />
      </div>
    )

  if (step.name === 'choose')
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Flare never had your passphrase, so it cannot restore it. What happens
          next depends on your recovery phrase, the 24 words you saved when you
          set your passphrase.
        </p>
        <button
          type="button"
          className={choiceClassName}
          onClick={() => show({ name: 'phrase' })}
        >
          <FileKey2
            className="mt-0.5 h-5 w-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>
            <span className="block font-medium">I have my recovery phrase</span>
            <span className="block text-muted-foreground">
              Choose a new passphrase and keep access to your encrypted files.
            </span>
          </span>
        </button>
        <button
          type="button"
          className={choiceClassName}
          onClick={() => show({ name: 'reset', hadKeys: true })}
        >
          <ShieldOff
            className="mt-0.5 h-5 w-5 shrink-0 text-danger"
            aria-hidden="true"
          />
          <span>
            <span className="block font-medium">I lost my recovery phrase</span>
            <span className="block text-muted-foreground">
              Keep the account with new keys. Its encrypted files can never be
              opened again.
            </span>
          </span>
        </button>
        {footer}
      </div>
    )

  if (step.name === 'phrase')
    return (
      <form onSubmit={checkPhrase} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="recovery-phrase">Recovery phrase</Label>
          <Textarea
            id="recovery-phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            rows={4}
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-sensitive="true"
            placeholder="24 words, with a space between them"
            className="font-mono"
            aria-describedby="recovery-phrase-hint"
          />
          <p
            id="recovery-phrase-hint"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            The phrase is checked in this browser against your account’s public
            key. It is never sent.
          </p>
        </div>
        {errorAlert}
        <Button type="submit" className="h-11 w-full">
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full"
          onClick={() => {
            setPhrase('')
            show({ name: 'choose' })
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      </form>
    )

  const resetting = step.name === 'reset' && step.hadKeys
  return (
    <form onSubmit={submitNewPassphrase} aria-busy={busy} className="space-y-4">
      {step.name === 'recover' ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your recovery phrase matches this account. Choose a new passphrase.
          You get a new recovery phrase, and the one you just typed stops
          working.
        </p>
      ) : resetting ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            A reset gives this account new keys. Without the recovery phrase,
            nobody can open the files it encrypted before, not you and not an
            administrator. They stay unreadable for good. Files that are not
            encrypted and your account settings are kept.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Choose the passphrase that signs you in and locks your encryption
          keys. It replaces your password and never leaves this browser.
        </p>
      )}
      <NewPassphraseFields
        form={form}
        idPrefix="reset"
        disabled={busy}
        inputClassName="h-11"
        label="New passphrase"
        confirmLabel="Confirm new passphrase"
        autoFocus
      />
      {resetting && (
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            disabled={busy}
            className="mt-1 h-4 w-4 accent-primary"
          />
          I understand that the encrypted files of this account can never be
          opened again.
        </label>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every session of the account ends and every API token is cancelled.
        Two-factor authentication and passkeys do not change.
      </p>
      {errorAlert}
      <Button
        type="submit"
        variant={resetting ? 'destructive' : 'default'}
        className="h-11 w-full"
        disabled={busy}
      >
        {busy ? (
          <>
            <Icons.spinner className="animate-spin" aria-hidden="true" />
            {DERIVING_KEYS}
          </>
        ) : resetting ? (
          'Reset account keys'
        ) : (
          'Set new passphrase'
        )}
      </Button>
      {link?.hasKeys && (
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => {
            form.reset()
            setUnderstood(false)
            show({ name: 'choose' })
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
      )}
      {!link?.hasKeys && footer}
    </form>
  )
}
