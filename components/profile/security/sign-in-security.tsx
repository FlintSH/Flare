'use client'

import { useEffect, useState } from 'react'

import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import {
  Check,
  Fingerprint,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { signOut } from 'next-auth/react'

import {
  type AccountPasskey,
  passkeyError,
  securityRequest,
} from '@/components/auth/security-api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

import { useSecurityStatus } from '@/hooks/use-security-status'

import { RecoveryCodes } from './recovery-codes'
import { SecurityProof, readSecurityProof } from './security-proof'

type Action =
  | 'setup'
  | 'disable'
  | 'codes'
  | 'add-passkey'
  | 'rename-passkey'
  | 'remove-passkey'
type Setup = { secret: string; uri: string; challengeId: string; qr?: string }

const titles: Record<Action, string> = {
  setup: 'Set up your authenticator',
  disable: 'Turn off two-factor authentication?',
  codes: 'Replace your recovery codes?',
  'add-passkey': 'Add a passkey',
  'rename-passkey': 'Rename passkey',
  'remove-passkey': 'Remove this passkey?',
}

export function SignInSecurity() {
  const {
    data: status,
    isPending,
    error: loadError,
    refetch,
  } = useSecurityStatus()
  const [supported, setSupported] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [selectedPasskey, setSelectedPasskey] = useState<AccountPasskey | null>(
    null
  )
  const [setup, setSetup] = useState<Setup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [complete, setComplete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSupported(window.isSecureContext && !!window.PublicKeyCredential)
  }, [])

  useEffect(() => {
    if (!codes) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [codes])

  async function openAction(next: Action, passkey?: AccountPasskey) {
    setAction(next)
    setSelectedPasskey(passkey ?? null)
    setSetup(null)
    setCodes(null)
    setComplete(false)
    setError(null)
    setNotice(null)
    // Fresh-authentication eligibility expires even while this page stays open.
    setBusy(true)
    try {
      const result = await refetch()
      if (result.error)
        setError(
          'Unable to refresh your security settings. Try again or sign in again.'
        )
    } finally {
      setBusy(false)
    }
  }

  function closeDialog() {
    if (busy || codes || complete) return
    setAction(null)
    setSetup(null)
    setError(null)
  }

  async function signInAgain() {
    setBusy(true)
    try {
      await signOut({ callbackUrl: '/auth/login?local=1' })
    } catch {
      setError('Unable to open sign-in. Open the login page to sign in again.')
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || busy) return
    const form = event.currentTarget
    const proof = readSecurityProof(form)
    const data = new FormData(form)
    setBusy(true)
    setError(null)
    try {
      if (action === 'setup') {
        if (!setup) {
          const next = await securityRequest<Setup>(
            '/api/auth/security/totp/setup',
            proof
          )
          // Generate the QR locally: the provisioning secret never goes to a third-party image service.
          const qr = await import('qrcode')
            .then((QRCode) =>
              QRCode.toDataURL(next.uri, { width: 224, margin: 2 })
            )
            .catch(() => undefined)
          setSetup({ ...next, qr })
        } else {
          const result = await securityRequest<{ recoveryCodes: string[] }>(
            '/api/auth/security/totp/enable',
            { code: data.get('setup-code'), challengeId: setup.challengeId }
          )
          setSetup(null)
          setCodes(result.recoveryCodes)
        }
      } else if (action === 'codes') {
        const result = await securityRequest<{ recoveryCodes: string[] }>(
          '/api/auth/security/recovery-codes',
          proof
        )
        setCodes(result.recoveryCodes)
      } else if (action === 'disable') {
        await securityRequest('/api/auth/security/totp/disable', proof)
        setComplete(true)
      } else if (action === 'add-passkey') {
        const { startRegistration } = await import('@simplewebauthn/browser')
        const result = await securityRequest<{
          options: PublicKeyCredentialCreationOptionsJSON
          challengeId: string
        }>('/api/auth/security/passkeys/options', {
          ...proof,
          name: data.get('passkey-name'),
        })
        const response = await startRegistration({
          optionsJSON: result.options,
        })
        await securityRequest('/api/auth/security/passkeys/verify', {
          challengeId: result.challengeId,
          response,
        })
        setComplete(true)
      } else if (selectedPasskey) {
        await securityRequest(
          `/api/auth/security/passkeys/${encodeURIComponent(selectedPasskey.id)}`,
          {
            ...proof,
            ...(action === 'rename-passkey'
              ? { name: data.get('passkey-name') }
              : {}),
          },
          action === 'rename-passkey' ? 'PATCH' : 'DELETE'
        )
        if (action === 'rename-passkey') {
          setAction(null)
          setNotice('Passkey renamed.')
          await refetch()
        } else {
          setComplete(true)
        }
      }
    } catch (cause) {
      setError(passkeyError(cause))
      // A recent passkey/SSO proof may have expired while this dialog was open.
      void refetch()
    } finally {
      setBusy(false)
    }
  }

  const needsSso =
    status &&
    !status.hasPassword &&
    !status.canUseRecentPasskey &&
    !status.canUseRecentRecovery &&
    !status.canUseRecentSso

  return (
    <Card id="sign-in-security" className="scroll-mt-28">
      <CardHeader className="space-y-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-1.5">
          <CardTitle>Sign-in security</CardTitle>
          <CardDescription>
            Add another layer of protection, or sign in with a passkey.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your security settings…
          </p>
        )}
        {loadError && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">
              Unable to load your security settings. Sign in again if your
              session has expired.
            </p>
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm text-primary">
            {notice}
          </p>
        )}
        {status && (
          <>
            <section
              aria-labelledby="authenticator-heading"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Smartphone
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 id="authenticator-heading" className="font-medium">
                      Authenticator app
                    </h3>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                      Use a six-digit code after your password when you sign in.
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.twoFactorEnabled ? 'border-primary/20 bg-primary/5 text-primary' : 'text-muted-foreground'}`}
                >
                  {status.twoFactorEnabled && (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  )}
                  {status.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                </span>
              </div>
              {status.twoFactorEnabled ? (
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    {status.recoveryCodesRemaining} recovery{' '}
                    {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'}{' '}
                    remaining
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Keep recovery codes somewhere safe in case you lose access
                    to your authenticator.
                  </p>
                  {status.recoveryCodesRemaining <= 2 && (
                    <p className="text-sm text-destructive">
                      {status.recoveryCodesRemaining === 0
                        ? 'You have no recovery codes left. Replace them now to keep a way back in.'
                        : 'Replace your recovery codes soon so you always have a way back in.'}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openAction('codes')}
                    >
                      Replace recovery codes
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openAction('disable')}
                    >
                      Turn off
                    </Button>
                  </div>
                </div>
              ) : status.hasPassword ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openAction('setup')}
                >
                  Set up authenticator
                </Button>
              ) : (
                <p className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Your account signs in through SSO. Manage two-factor
                  authentication with your identity provider. You can also add a
                  passkey below.
                </p>
              )}
            </section>
            <section
              aria-labelledby="passkeys-heading"
              className="space-y-4 border-t pt-6"
            >
              <div className="flex items-start gap-3">
                <Fingerprint
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <h3 id="passkeys-heading" className="font-medium">
                    Passkeys
                  </h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Sign in with your fingerprint, face, device PIN, or security
                    key. A passkey replaces both your password and authenticator
                    code.
                  </p>
                </div>
              </div>
              {status.passkeys.length > 0 ? (
                <ul className="divide-y rounded-xl border">
                  {status.passkeys.map((passkey) => (
                    <li
                      key={passkey.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium">
                          {passkey.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Added{' '}
                          {new Date(passkey.createdAt).toLocaleDateString()}
                          {passkey.lastUsedAt
                            ? ` · Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                            : ' · Not used yet'}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Rename ${passkey.name}`}
                          onClick={() => openAction('rename-passkey', passkey)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${passkey.name}`}
                          onClick={() => openAction('remove-passkey', passkey)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                  No passkeys yet. Add one from a device or password manager you
                  trust.
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={
                  !supported ||
                  !status.passkeysAvailable ||
                  status.passkeys.length >= 10
                }
                onClick={() => openAction('add-passkey')}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add a passkey
              </Button>
              {(!supported || !status.passkeysAvailable) && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Passkeys require a supported browser at your instance’s
                  configured HTTPS address, or localhost for development.
                </p>
              )}
              {status.passkeys.length >= 10 && (
                <p className="text-xs text-muted-foreground">
                  You can keep up to 10 passkeys. Remove one before adding
                  another.
                </p>
              )}
            </section>
          </>
        )}
      </CardContent>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent
          showCloseButton={!codes && !complete && !busy}
          onEscapeKeyDown={(event) => {
            if (busy || codes || complete) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy || codes || complete) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {codes
                ? 'Save your recovery codes'
                : complete
                  ? 'Your security settings are updated'
                  : action
                    ? titles[action]
                    : 'Sign-in security'}
            </DialogTitle>
            <DialogDescription>
              {codes
                ? 'These codes are shown only once. Save them before continuing.'
                : complete
                  ? 'For your protection, all previous sessions have ended. Sign in again to continue.'
                  : action === 'setup'
                    ? setup
                      ? 'Scan the QR code with your authenticator app, then enter the code it generates.'
                      : 'First, confirm your identity. You will connect your app in the next step.'
                    : action === 'codes'
                      ? 'Your old recovery codes will stop working immediately. Save the new set before signing in again.'
                      : action === 'disable'
                        ? 'Your password will no longer need an authenticator code. Existing recovery codes will also stop working.'
                        : action === 'add-passkey'
                          ? 'Give your passkey a name you will recognize, then follow your browser’s instructions.'
                          : action === 'remove-passkey'
                            ? `“${selectedPasskey?.name}” will no longer sign in to Flare. This does not delete it from your device or password manager.`
                            : 'Choose a name that helps you recognize this device or password manager.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {codes ? (
            <RecoveryCodes
              codes={codes}
              onDone={() => {
                setCodes(null)
                setComplete(true)
              }}
            />
          ) : complete ? (
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={signInAgain}
            >
              {busy ? 'Opening sign-in…' : 'Sign in again'}
            </Button>
          ) : (
            status &&
            action && (
              <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
                {setup ? (
                  <>
                    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                      {setup.qr && (
                        <div className="mx-auto w-fit rounded-xl bg-white p-2">
                          <img
                            src={setup.qr}
                            width={224}
                            height={224}
                            alt="QR code for adding Flare to your authenticator app"
                            className="h-auto max-w-full"
                            data-sensitive="true"
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Or enter this setup key manually
                        </p>
                        <code
                          className="block break-all rounded-lg border bg-background p-3 text-center text-sm tracking-wide select-all"
                          data-sensitive="true"
                        >
                          {setup.secret}
                        </code>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Keep this key private. Setup expires after 5 minutes;
                        cancel and start again if needed.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="setup-code">Authenticator code</Label>
                      <Input
                        data-sensitive="true"
                        id="setup-code"
                        name="setup-code"
                        placeholder="000000"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={busy}
                        autoFocus
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {(action === 'add-passkey' ||
                      action === 'rename-passkey') && (
                      <div className="space-y-2">
                        <Label htmlFor="passkey-name">Passkey name</Label>
                        <Input
                          id="passkey-name"
                          name="passkey-name"
                          defaultValue={selectedPasskey?.name ?? ''}
                          placeholder="For example, Personal laptop"
                          maxLength={64}
                          required
                          disabled={busy}
                          autoFocus
                        />
                      </div>
                    )}
                    <SecurityProof status={status} busy={busy} />
                  </>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={closeDialog}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-auto min-h-10 whitespace-normal"
                    variant={
                      action === 'disable' || action === 'remove-passkey'
                        ? 'destructive'
                        : 'default'
                    }
                    disabled={busy || (!!needsSso && !setup)}
                  >
                    {busy ? (
                      <>
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Please wait…
                      </>
                    ) : action === 'setup' ? (
                      setup ? (
                        'Enable two-factor authentication'
                      ) : (
                        'Continue'
                      )
                    ) : action === 'codes' ? (
                      'Replace recovery codes'
                    ) : action === 'disable' ? (
                      'Turn off two-factor authentication'
                    ) : action === 'add-passkey' ? (
                      'Create passkey'
                    ) : action === 'rename-passkey' ? (
                      'Save name'
                    ) : (
                      'Remove passkey'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            )
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
