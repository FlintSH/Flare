'use client'

import { useRouter } from 'next/navigation'

import { ToastAction } from '@/components/ui/toast'
import { UPLOAD_PROFILES } from '@/components/upload-profiles/profile-picker'

import {
  defaultsWritten,
  setDefaultProfile,
  updateProfile,
} from '@/lib/client/profile'
import { RefusedRequest } from '@/lib/client/request'
import type { ExpiryAction } from '@/lib/uploads/choices'
import type { UploadProfileOptions } from '@/lib/uploads/schema'

import { useAccountRefresh } from '@/hooks/use-account-query'
import { useToast } from '@/hooks/use-toast'

type Expiration = Required<UploadProfileOptions>['expiration']

/**
 * Saving a choice made on Upload or Paste as a default, from the chip that
 * made it: the account's expiry, or the default upload profile. Each save
 * can be undone from its notice, which restores what was there before.
 */
/** Saves in progress in this tab, one per default. */
const saving = { expiry: false, profile: false }

export function useSaveDefaults() {
  const router = useRouter()
  const { toast } = useToast()
  const refreshProfiles = useAccountRefresh(UPLOAD_PROFILES)

  const settle = async () => {
    await refreshProfiles()
    router.refresh()
  }
  const failed = (failure: unknown, title: string) =>
    toast({
      title,
      description: failure instanceof Error ? failure.message : undefined,
      variant: 'destructive',
    })

  const writeExpiry = (expiration: Expiration, action: ExpiryAction) =>
    updateProfile(
      {
        defaultFileExpiration: expiration,
        defaultFileExpirationAction: action,
      },
      'Your default couldn’t be saved.'
    )

  const busyNotice = () =>
    toast({
      title: 'One moment',
      description: 'The last change is still saving.',
    })
  const changedSince = () =>
    toast({
      title: 'Nothing undone',
      description: 'Your default changed again since then.',
    })

  const writeDefaultProfile = (profileId: string | null) =>
    setDefaultProfile(profileId)

  /**
   * Undo for a saved default: restores what was there, once, and only while
   * no other write to it started since `saved`. A failed Undo says so and
   * can be tried again from that notice.
   */
  const undoAction = (
    kind: 'expiry' | 'profile',
    saved: number,
    altText: string,
    restore: () => Promise<unknown>,
    label = 'Undo'
  ) => (
    <ToastAction
      altText={altText}
      onClick={() => {
        // Once: a second click finds its own write and does nothing.
        if (defaultsWritten[kind] !== saved) return changedSince()
        if (saving[kind]) return busyNotice()
        saving[kind] = true
        const undoing = restore()
        const undone = defaultsWritten[kind]
        // The page catching up after is separate: its failing isn't the
        // Undo's.
        void undoing
          .then(
            () => {
              toast({ title: 'Undone' })
              void settle().catch(() => {})
            },
            (failure) => {
              // Not undone: offered again unless another write started.
              toast({
                title: 'Couldn’t undo',
                description:
                  failure instanceof Error ? failure.message : undefined,
                variant: 'destructive',
                // Not when the server refused what's put back (a profile
                // deleted since): trying again can't help.
                action:
                  defaultsWritten[kind] === undone &&
                  !(
                    failure instanceof RefusedRequest &&
                    failure.status >= 400 &&
                    failure.status < 500 &&
                    failure.status !== 429
                  )
                    ? undoAction(kind, undone, altText, restore, 'Try again')
                    : undefined,
              })
            }
          )
          .finally(() => {
            saving[kind] = false
          })
      }}
    >
      {label}
    </ToastAction>
  )

  return {
    /** Makes this expiry the account's own; `done` clears the chip's choice. */
    async saveExpiry(
      next: { expiration: Expiration; action: ExpiryAction; label: string },
      previous: { expiration: Expiration; action: ExpiryAction },
      done: () => void
    ) {
      // One at a time: what a save replaces (and its Undo restores) must be
      // what the one before left, not what it started from.
      if (saving.expiry) return busyNotice()
      saving.expiry = true
      try {
        // Undo only while no other write (here or on Profile) started after
        // this one: counted as each starts.
        const writing = writeExpiry(next.expiration, next.action)
        const saved = defaultsWritten.expiry
        await writing
        done()
        // Saved: the page catching up failing doesn't undo that.
        await settle().catch(() => {})
        toast({
          title: 'Default expiry saved',
          description: `${next.label} for uploads and pastes from now on.`,
          action: undoAction(
            'expiry',
            saved,
            'Undo the new default expiry',
            () => writeExpiry(previous.expiration, previous.action)
          ),
        })
      } catch (failure) {
        failed(failure, 'Couldn’t save the default')
      } finally {
        saving.expiry = false
      }
    },
    /** Makes a profile (or none) the default; `done` clears the chip's choice. */
    async makeDefault(
      profile: { id: string; name: string } | null,
      previousId: string | null,
      done: () => void
    ) {
      if (saving.profile) return busyNotice()
      saving.profile = true
      try {
        const writing = writeDefaultProfile(profile?.id ?? null)
        const saved = defaultsWritten.profile
        await writing
        done()
        // Saved: the page catching up failing doesn't undo that.
        await settle().catch(() => {})
        toast({
          title: profile
            ? `${profile.name} is your default profile`
            : 'No default profile',
          description: 'Uploads, pastes and your screenshot tools use it.',
          action: undoAction(
            'profile',
            saved,
            'Undo the default profile change',
            () => writeDefaultProfile(previousId)
          ),
        })
      } catch (failure) {
        failed(failure, 'Couldn’t change the default profile')
      } finally {
        saving.profile = false
      }
    },
  }
}
