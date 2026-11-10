'use client'

import { useState } from 'react'

import { Loader2 } from 'lucide-react'

import {
  DERIVING_FILE_KEY,
  FilePasswordStrength,
  useFilePasswordStrength,
} from '@/components/encryption/file-password'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
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

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { workerArgon2id } from '@/lib/e2ee/client/argon2-worker'
import { type OpenedFile, newPasswordStanza } from '@/lib/e2ee/client/files'
import { shareLink } from '@/lib/e2ee/link'
import { fileUrls } from '@/lib/files/urls'

import { useToast } from '@/hooks/use-toast'

/**
 * Adds, changes or removes the password of an encrypted file
 * (docs/e2ee-spec.md, section 8.2). The browser makes a password stanza and
 * sends only that: Flare never receives the password. A new password makes a
 * new link, and the link of the old password stops.
 */
export function EncryptedFilePasswordDialog({
  file,
  opened,
  open,
  onOpenChange,
  onUpdated,
}: {
  file: { id: string; name: string; urlPath: string; hasPassword: boolean }
  opened: OpenedFile
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated?: () => void
}) {
  const { state } = useAccountKeys()
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'deriving' | 'saving' | null>(null)
  const [error, setError] = useState('')
  const { strength, failed, problem } = useFilePasswordStrength(password, open)
  const id = `encrypted-password-${file.id}`

  const close = (next: boolean) => {
    if (busy) return
    setPassword('')
    setError('')
    onOpenChange(next)
  }

  const save = async () => {
    if (busy || (password ? problem : !file.hasPassword)) return
    if (state.status !== 'unlocked') {
      setError('Unlock your encryption keys to change this password.')
      return
    }
    setError('')
    try {
      let passwordStanza: string | null = null
      let link: string | null = null
      if (password) {
        setBusy('deriving')
        const made = await newPasswordStanza({
          opened,
          password,
          ownerPublicKey: state.keys.accountPublicKey,
          argon2id: workerArgon2id,
        })
        passwordStanza = made.passwordStanza
        link = shareLink(
          fileUrls(file, { origin: window.location.origin }).page,
          made.secret
        )
      }
      setBusy('saving')
      await apiRequest(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: { passwordStanza },
        fallback: 'Please try again.',
      })
      let copied = false
      if (link)
        try {
          await navigator.clipboard.writeText(link)
          copied = true
        } catch {
          // The card's "Copy link" gives the same link.
        }
      toast({
        title: password
          ? 'Password protection enabled'
          : 'Password protection removed',
        description: password
          ? copied
            ? 'The new link is copied. It opens the file only with this password.'
            : 'Copy the file’s link again: it changed with the password.'
          : 'The file’s link changed. Copy it again to share the file.',
      })
      setPassword('')
      setBusy(null)
      onOpenChange(false)
      onUpdated?.()
    } catch (failure) {
      setBusy(null)
      setError(
        failure instanceof RefusedRequest
          ? failure.message
          : 'The password could not be saved. Please try again.'
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {file.hasPassword ? 'Manage password' : 'Protect this file'}
          </DialogTitle>
          <DialogDescription className="break-words">
            {file.hasPassword
              ? 'Change or remove the password of'
              : 'Add a password to'}{' '}
            <span className="font-medium text-foreground">{file.name}</span>.
            Flare never receives it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor={id}>
              {file.hasPassword ? 'New password' : 'Password'}
            </Label>
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={Boolean(busy)}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter a password"
              aria-invalid={Boolean(
                password && strength && !strength.acceptable
              )}
              aria-describedby={`${id}-hint`}
            />
            <FilePasswordStrength
              id={`${id}-hint`}
              password={password}
              strength={strength}
              failed={failed}
              empty={
                file.hasPassword
                  ? 'Type a new password, or leave this empty to remove the current one.'
                  : 'Use several unrelated words. People need the link and this password to open the file.'
              }
            />
          </div>
          <p className="text-pretty rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {file.hasPassword
              ? 'The link changes with the password. The link of the old password stops opening this file.'
              : 'The link changes when you add a password. A person who already has the current link keeps the key in it and can still open this file. To shut them out, delete the file and upload it again.'}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                Boolean(busy) ||
                (password ? Boolean(problem) : !file.hasPassword)
              }
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy === 'deriving'
                ? DERIVING_FILE_KEY
                : file.hasPassword
                  ? password
                    ? 'Update password'
                    : 'Remove password'
                  : 'Add password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
