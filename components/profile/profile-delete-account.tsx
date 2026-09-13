'use client'

import { useState } from 'react'

import { Loader2, Trash2 } from 'lucide-react'
import { signOut } from 'next-auth/react'

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

export function ProfileDeleteAccount() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  async function removeAccount() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/profile', { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || 'Your account could not be deleted.')
      }
      await signOut({ callbackUrl: '/auth/login' })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to delete your account.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-full sm:w-auto">
          <Trash2 className="h-4 w-4" />
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes your account and its files and links. You
            cannot undo this action. Export anything you want to keep first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep account</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault()
              void removeAccount()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Deleting account…' : 'Delete account permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
