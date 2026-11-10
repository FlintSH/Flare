'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Pause, Play } from 'lucide-react'

import { useAccountKeys } from '@/components/providers/account-keys-provider'

import {
  libraryMaintenance,
  onKeyringPruned,
  onMaintenanceChange,
} from '@/lib/library/browser-maintenance'
import { libraryChanged } from '@/lib/library/changes'

/**
 * Runs the background work of the library while the account keys are
 * unlocked in this browser, and shows what it does in a small status at the
 * edge of the page (docs/e2ee-spec.md, section 9.7). The work stops when the
 * browser locks or the session ends.
 */
export function LibraryMaintenance() {
  const { state: account, adopt } = useAccountKeys()
  const client = useQueryClient()
  const keys = account.status === 'unlocked' ? account.keys : null
  const state = useSyncExternalStore(
    libraryMaintenance.subscribe,
    libraryMaintenance.getState,
    libraryMaintenance.getState
  )

  useEffect(() => {
    if (!keys) return
    onMaintenanceChange(() => void libraryChanged(client))
    // After the stanza migration, the browser keeps only the old keys that
    // the new keyring holds (docs/e2ee-spec.md, section 8.3.4, step 5).
    onKeyringPruned((oldPrivateKeys) => {
      void adopt({
        accountKeys: {
          accountPrivateKey: keys.accountPrivateKey,
          accountPublicKey: keys.accountPublicKey,
        } as Parameters<typeof adopt>[0]['accountKeys'],
        oldPrivateKeys,
      })
    })
    libraryMaintenance.start(keys)
    return () => {
      libraryMaintenance.stop()
      onMaintenanceChange(null)
      onKeyringPruned(null)
    }
  }, [keys, client, adopt])

  const { progress, paused } = state
  if (!progress) return null
  const counted =
    progress.total !== null && progress.total > 0
      ? ` · ${Math.min(progress.done, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}`
      : ''
  return (
    <div
      role="status"
      aria-live="polite"
      data-library-work=""
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:inset-x-auto sm:left-4 sm:justify-start sm:px-0"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-overlay py-1.5 pl-3 pr-1.5 text-xs text-muted-foreground shadow-lg shadow-black/10">
        {paused ? (
          <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate">
          {paused ? 'Paused' : progress.label}
          {counted}
        </span>
        <button
          type="button"
          onClick={() =>
            paused ? libraryMaintenance.resume() : libraryMaintenance.pause()
          }
          aria-label={
            paused ? 'Resume background work' : 'Pause background work'
          }
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}
