'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { Loader2, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { apiRequest } from '@/lib/client/request'

import { useSignOut } from '@/hooks/use-sign-out'

function revealRecoveryAction(action: HTMLButtonElement | null) {
  action?.focus({ preventScroll: true })
  action?.scrollIntoView({ block: 'nearest' })
}

export function ProfileDeleteAccount() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState('')
  const [deleted, setDeleted] = useState(false)
  const intentId = useId()
  const retryRef = useRef<HTMLButtonElement>(null)
  const failed = (
    cause: unknown,
    fallback = 'Unable to delete your account.'
  ) => setError(cause instanceof Error ? cause.message : fallback)
  const signOut = useSignOut({
    onError: (_cause, message) => setError(message),
  })

  useEffect(() => {
    if (deleted && !busy) revealRecoveryAction(retryRef.current)
  }, [deleted, busy, error])

  async function removeAccount() {
    if (busy || (!deleted && intent !== 'DELETE')) return
    setBusy(true)
    setError('')
    try {
      if (!deleted) {
        await apiRequest('/api/profile', {
          method: 'DELETE',
          fallback: 'Your account could not be deleted.',
        })
        setDeleted(true)
        setIntent('')
      }
      await signOut()
    } catch (cause) {
      failed(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (busy || deleted) return
        setOpen(value)
        setIntent('')
        setError('')
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          className="w-full sm:w-auto"
          disabled={deleted}
        >
          <Trash2 className="h-4 w-4" />
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (!busy && !deleted) return
          event.preventDefault()
          if (deleted && !busy) revealRecoveryAction(retryRef.current)
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleted ? 'Your account has been deleted' : 'Delete your account?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleted ? (
              'Your account was deleted. Finish signing out of this browser. File and avatar cleanup continues in the background.'
            ) : (
              <>
                This removes your account, files, short links, integrations, and
                invites you created. Export anything you want to keep first;
                there is no account-restore button.
                <span className="mt-2 block">
                  File and avatar cleanup runs afterward. People who joined
                  through your invites keep their accounts. Audit history,
                  backups, and external copies may remain.
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!deleted && (
          <div className="space-y-2">
            <Label htmlFor={intentId}>Type DELETE to confirm</Label>
            <Input
              id={intentId}
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-h-[44px]"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          {!deleted && (
            <AlertDialogCancel
              disabled={busy}
              className="h-auto min-h-[44px] whitespace-normal"
            >
              Keep account
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            ref={retryRef}
            disabled={busy || (!deleted && intent !== 'DELETE')}
            onClick={(event) => {
              event.preventDefault()
              void removeAccount()
            }}
            className={`h-auto min-h-[44px] whitespace-normal ${deleted ? '' : 'bg-destructive-fill text-destructive-foreground hover:brightness-110'}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {deleted
              ? busy
                ? 'Signing out…'
                : 'Try signing out again'
              : busy
                ? 'Deleting account…'
                : 'Delete account permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
