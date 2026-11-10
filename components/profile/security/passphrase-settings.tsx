'use client'

import { useState } from 'react'

import { AlertCircle, KeyRound, ScrollText } from 'lucide-react'
import { useSession } from 'next-auth/react'

import {
  DERIVING_KEYS,
  NewPassphraseFields,
  useNewPassphrase,
} from '@/components/encryption/passphrase-fields'
import {
  RecoveryPhrase,
  RecoveryPhraseActions,
  RecoveryPhraseWords,
} from '@/components/encryption/recovery-phrase'
import { passphraseError } from '@/components/encryption/unlock-dialog'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { useAppearance } from '@/components/providers/appearance-context'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { changePassphrase, revealRecoveryPhrase } from '@/lib/e2ee/client/api'
import { wipeAccountKeys } from '@/lib/e2ee/client/procedures'
import { PASSPHRASE_MAX_LENGTH } from '@/lib/e2ee/client/strength'
import { wipe } from '@/lib/e2ee/primitives'

import { useSignOut } from '@/hooks/use-sign-out'

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

/**
 * A passphrase change, which is a full key rotation (docs/e2ee-spec.md,
 * sections 6.7 and 8.3.3). The dialog says what the rotation cancels before
 * it asks for anything.
 */
function ChangePassphraseDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, lock } = useAccountKeys()
  const { data: session } = useSession()
  const { brand } = useAppearance()
  const signOut = useSignOut()
  const identifier =
    state.status === 'locked' || state.status === 'unlocked'
      ? state.identifier
      : null
  const form = useNewPassphrase([identifier, session?.user?.name, brand.name])
  const [step, setStep] = useState<'warning' | 'form'>('warning')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string | null>(null)

  function close() {
    setStep('warning')
    setCurrent('')
    setError(null)
    form.reset()
    onOpenChange(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (!current) {
      setError('Enter your current passphrase.')
      return
    }
    if (form.problem) {
      setError(form.problem)
      return
    }
    if (form.passphrase === current) {
      setError('The new passphrase must be different from the current one.')
      return
    }
    setBusy(true)
    try {
      const result = await changePassphrase({
        currentPassphrase: current,
        newPassphrase: form.passphrase,
      })
      // Every session ended with the rotation, this one too. The old keys
      // of this browser open nothing new.
      await lock().catch(() => undefined)
      setCurrent('')
      form.reset()
      setMnemonic(result.mnemonic)
    } catch (cause) {
      setError(
        passphraseError(cause).replace(
          'That passphrase is not correct.',
          'Your current passphrase is not correct.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The new recovery phrase must be saved, and a rotation in progress
        // must finish.
        if (!next && (busy || mnemonic)) return
        if (!next) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onInteractOutside={(event) => {
          if (busy || mnemonic || step === 'form') event.preventDefault()
        }}
      >
        {mnemonic ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your new recovery phrase</DialogTitle>
              <DialogDescription>
                Your passphrase was changed and every session was signed out.
                Save this phrase, then sign in with your new passphrase.
              </DialogDescription>
            </DialogHeader>
            <RecoveryPhrase
              mnemonic={mnemonic}
              replacesOld
              doneLabel="Sign in again"
              onDone={() => void signOut()}
            />
          </>
        ) : step === 'warning' ? (
          <>
            <DialogHeader>
              <DialogTitle>Change your passphrase</DialogTitle>
              <DialogDescription>
                A new passphrase makes new encryption keys for your account.
                Read what that does before you start.
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
              <li>
                <strong className="font-medium">Every session ends</strong>, on
                every device and in this browser. You sign in again with the new
                passphrase.
              </li>
              <li>
                <strong className="font-medium">
                  Every API token is deleted
                </strong>{' '}
                and an upload token from before encryption is revoked.
                Screenshot tools and scripts stop uploading until you create a
                new configuration for each.
              </li>
              <li>
                <strong className="font-medium">
                  You get a new recovery phrase.
                </strong>{' '}
                The one you have now stops working.
              </li>
            </ul>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your files, two-factor authentication and passkeys do not change.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setStep('form')}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Change your passphrase</DialogTitle>
              <DialogDescription>
                Both passphrases stay in this browser. Flare checks signatures
                made from them.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} aria-busy={busy} className="space-y-4">
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={identifier ?? ''}
                readOnly
                hidden
              />
              <div className="space-y-2">
                <Label htmlFor="current-passphrase">Current passphrase</Label>
                <Input
                  id="current-passphrase"
                  name="current-passphrase"
                  type="password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  placeholder="Enter your current passphrase"
                  autoComplete="current-password"
                  maxLength={PASSPHRASE_MAX_LENGTH}
                  required
                  disabled={busy}
                  autoFocus
                  data-sensitive="true"
                />
              </div>
              <NewPassphraseFields
                form={form}
                idPrefix="change"
                disabled={busy}
                label="New passphrase"
                confirmLabel="Confirm new passphrase"
                placeholder="Choose a new passphrase"
              />
              <ErrorAlert message={error} />
              {busy && (
                <p role="status" className="text-xs text-muted-foreground">
                  Deriving the old and the new keys takes a few seconds. Keep
                  this page open.
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <>
                      <Icons.spinner
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      {DERIVING_KEYS}
                    </>
                  ) : (
                    'Change passphrase and sign out'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Shows the recovery phrase again to a person who types the passphrase (section 6.5). */
function ShowRecoveryPhraseDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, adopt } = useAccountKeys()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mnemonic, setMnemonic] = useState<string | null>(null)

  function close() {
    setMnemonic(null)
    setError(null)
    onOpenChange(false)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const passphrase = new FormData(event.currentTarget).get('passphrase')
    if (typeof passphrase !== 'string' || !passphrase) return
    setBusy(true)
    setError(null)
    try {
      const revealed = await revealRecoveryPhrase(passphrase)
      try {
        // The proof also opened the keys, so a locked browser is unlocked.
        await adopt(revealed).catch(() => undefined)
      } finally {
        wipeAccountKeys(revealed.accountKeys)
        wipe(...revealed.oldPrivateKeys)
      }
      setMnemonic(revealed.mnemonic)
    } catch (cause) {
      setError(passphraseError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your recovery phrase</DialogTitle>
          <DialogDescription>
            {mnemonic
              ? 'These 24 words recover your account and its encrypted files if you forget your passphrase. Keep them offline. Anyone who has them can read your files.'
              : 'Enter your passphrase to show the 24 words that recover your account. Make sure nobody can see your screen.'}
          </DialogDescription>
        </DialogHeader>
        {mnemonic ? (
          <div className="space-y-4">
            <RecoveryPhraseWords words={mnemonic.split(' ')} />
            <RecoveryPhraseActions mnemonic={mnemonic} />
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} aria-busy={busy} className="space-y-4">
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={
                state.status === 'locked' || state.status === 'unlocked'
                  ? state.identifier
                  : ''
              }
              readOnly
              hidden
            />
            <div className="space-y-2">
              <Label htmlFor="reveal-passphrase">Passphrase</Label>
              <Input
                id="reveal-passphrase"
                name="passphrase"
                type="password"
                placeholder="Enter your passphrase"
                autoComplete="current-password"
                maxLength={PASSPHRASE_MAX_LENGTH}
                required
                disabled={busy}
                autoFocus
                data-sensitive="true"
              />
            </div>
            <ErrorAlert message={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <Icons.spinner
                      className="animate-spin"
                      aria-hidden="true"
                    />
                    {DERIVING_KEYS}
                  </>
                ) : (
                  'Show recovery phrase'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The passphrase section of Profile for an account that has encryption keys. */
export function PassphraseSettings() {
  const [dialog, setDialog] = useState<'change' | 'reveal' | null>(null)
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Recovery phrase</p>
          <p className="text-sm text-muted-foreground">
            The 24 words that recover your account if you forget your
            passphrase.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
          onClick={() => setDialog('reveal')}
        >
          <ScrollText aria-hidden="true" />
          Show recovery phrase
        </Button>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Passphrase</p>
          <p className="text-sm text-muted-foreground">
            Changing it makes new keys, signs out every session and cancels
            every API token.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-auto"
          onClick={() => setDialog('change')}
        >
          <KeyRound aria-hidden="true" />
          Change passphrase
        </Button>
      </div>
      <ChangePassphraseDialog
        open={dialog === 'change'}
        onOpenChange={(open) => setDialog(open ? 'change' : null)}
      />
      <ShowRecoveryPhraseDialog
        open={dialog === 'reveal'}
        onOpenChange={(open) => setDialog(open ? 'reveal' : null)}
      />
    </div>
  )
}
