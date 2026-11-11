'use client'

import { useState } from 'react'

import { TriangleAlert } from 'lucide-react'

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

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import type { LegacyUploadTokenStatus } from '@/lib/users/legacy-upload-token'

import { useToast } from '@/hooks/use-toast'

const usedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

/**
 * Shown while the upload token from before end-to-end encryption still
 * works (docs/e2ee-spec.md, section 14.4). A tool that holds it cannot
 * encrypt, so its uploads are plain files. Flare stores only the hash of
 * the token and cannot show it; the user installs a new configuration and
 * revokes the old token here.
 */
export function LegacyTokenWarning({
  status,
  onRevoked,
}: {
  status: LegacyUploadTokenStatus
  onRevoked: () => void | Promise<unknown>
}) {
  const { toast } = useToast()
  const [revoking, setRevoking] = useState(false)
  if (!status.active) return null

  async function revoke() {
    setRevoking(true)
    try {
      await apiRequest('/api/profile/upload-tools/legacy-token', {
        method: 'DELETE',
        fallback: 'Could not revoke the old upload token.',
      })
      await onRevoked()
      toast({
        title: 'Old upload token revoked',
        description: 'Tools that still use it can no longer upload.',
      })
    } catch (failure) {
      toast({
        title: 'Could not revoke the old upload token',
        description:
          failure instanceof RefusedRequest
            ? failure.message
            : 'Check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div
      role="status"
      data-legacy-token-warning
      className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-start"
    >
      <TriangleAlert
        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">
          Configurations from before encryption upload plain files
        </p>
        <p className="text-pretty text-sm text-muted-foreground">
          {status.lastUsedAt
            ? `A tool last uploaded with your old upload token on ${usedOn(status.lastUsedAt)}. `
            : 'Your old upload token still works. '}
          Tools that hold it cannot encrypt, so the server can read what they
          send. Flare no longer stores or shows that token.{' '}
          {status.hasNewConfiguration
            ? 'Once every tool uses a new configuration, revoke the old token.'
            : 'Create a configuration below, install it in each tool, then revoke the old token.'}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="shrink-0" disabled={revoking}>
            {revoking ? 'Revoking…' : 'Revoke old token'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke your old upload token?</AlertDialogTitle>
            <AlertDialogDescription>
              Every tool that still uses a configuration from before encryption
              stops uploading. This cannot be undone: Flare does not issue the
              old kind of token again. Tools with a new configuration keep
              working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void revoke()}>
              Revoke old token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
