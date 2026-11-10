'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { AlertCircle, LockKeyhole } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { authLinkClassName } from '@/components/auth/auth-shell'
import { DERIVING_KEYS } from '@/components/encryption/passphrase-fields'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
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

import { RefusedRequest } from '@/lib/client/request'
import { PASSPHRASE_MAX_LENGTH } from '@/lib/e2ee/client/strength'
import { isE2eeError } from '@/lib/e2ee/errors'

/** Why an unlock or another passphrase proof failed, in words for the person. */
export function passphraseError(cause: unknown): string {
  if (cause instanceof RefusedRequest) {
    if (cause.code === 'invalid_proof') return 'That passphrase is not correct.'
    if (cause.status === 401)
      return 'Your session ended. Sign in again to continue.'
    return cause.message
  }
  if (isE2eeError(cause, 'tag_mismatch'))
    return 'That passphrase is not correct.'
  if (isE2eeError(cause, 'unknown_version'))
    return 'This account uses a newer version of Flare’s encryption. Reload the page, or ask your administrator to update Flare.'
  return 'Something went wrong. Please try again.'
}

/** The passphrase prompt of a signed-in browser that holds no keys (docs/e2ee-spec.md, section 6.3). */
export function UnlockDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, unlock } = useAccountKeys()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const passphrase = new FormData(event.currentTarget).get('passphrase')
    if (typeof passphrase !== 'string' || !passphrase) return
    setBusy(true)
    setError(null)
    try {
      const after = await unlock(passphrase)
      if (after.status === 'unlocked') onOpenChange(false)
      else setError('Your account changed. Reload the page and try again.')
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
        setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock your encryption keys</DialogTitle>
          <DialogDescription>
            Enter your passphrase to open your keys in this browser. It is
            checked here and never sent to the server.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} aria-busy={busy} className="space-y-4">
          {/* Password managers match the passphrase to this address. */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={state.status === 'locked' ? state.identifier : ''}
            readOnly
            hidden
          />
          <div className="space-y-2">
            <Label htmlFor="unlock-passphrase">Passphrase</Label>
            <Input
              id="unlock-passphrase"
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
            <p className="text-right text-xs">
              <Link href="/auth/forgot-password" className={authLinkClassName}>
                Forgot your passphrase?
              </Link>
            </p>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Not now
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Icons.spinner className="animate-spin" aria-hidden="true" />
                  {DERIVING_KEYS}
                </>
              ) : (
                'Unlock'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A sign-in this recent opens the prompt by itself, one time. */
const FRESH_SIGN_IN_MS = 2 * 60_000
const PROMPTED_KEY = 'flare-unlock-prompted'

/**
 * Whether the prompt already opened for this sign-in. The mark is the time
 * of the sign-in, which is no secret, and it lasts as long as the tab, so a
 * reload does not open the prompt a second time.
 */
function claimPrompt(authTime: number) {
  try {
    if (sessionStorage.getItem(PROMPTED_KEY) === String(authTime)) return false
    sessionStorage.setItem(PROMPTED_KEY, String(authTime))
  } catch {
    // Without session storage the prompt opens again after a reload.
  }
  return true
}

/**
 * The notice of a locked browser. It does not block the page: until files
 * are encrypted, nothing in the application needs the key. Directly after a
 * passkey or SSO sign-in the prompt opens by itself, one time.
 */
export function UnlockBanner() {
  const { state } = useAccountKeys()
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const locked = state.status === 'locked'
  const authTime = session?.user?.authTime

  useEffect(() => {
    if (!locked || !authTime) return
    const age = Date.now() - authTime
    if (age < 0 || age > FRESH_SIGN_IN_MS) return
    if (claimPrompt(authTime)) setOpen(true)
  }, [locked, authTime])

  if (!locked) return null
  return (
    <>
      <div
        role="status"
        data-unlock-banner=""
        className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl sm:items-center sm:gap-x-4 border border-border/60 bg-card/80 px-4 py-2.5 text-sm shadow-sm backdrop-blur-xl"
      >
        <LockKeyhole
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 basis-56 leading-relaxed">
          Your encryption keys are locked in this browser.{' '}
          <span className="text-muted-foreground">
            Unlock them with your passphrase.
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          Unlock
        </Button>
      </div>
      <UnlockDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
