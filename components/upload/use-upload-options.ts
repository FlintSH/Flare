'use client'

import { useEffect, useMemo, useState } from 'react'

import { filePasswordHint } from '@/lib/files/password-policy'
import { allows } from '@/lib/permissions/actions'
import {
  NO_CHOICES,
  type UploadChoices,
  effectiveUpload,
  uploadOptionsFor,
} from '@/lib/uploads/choices'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
} from '@/lib/uploads/schema'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useTags } from '@/hooks/use-tags'

import { useUploadProfiles } from '../upload-profiles/profile-picker'

/**
 * The options for one upload or paste: what is picked, what that comes to
 * with the saved settings, and why sending would fail, if it would.
 */
export function useUploadOptions(
  saved: SavedUploadSettings,
  initialFolder: string | null = null
) {
  const { user, can } = usePermissions()
  const canShare = allows(user, 'shareFiles')
  // Until the session loads, keep a requested folder: the server refuses it
  // to roles that can't file uploads into folders.
  const canChooseFolder = !user || allows(user, 'fileIntoFolder')
  const canTag = can('tags.manage')
  const canChooseProfile = can('uploadProfiles.manage')
  const [choices, setChoices] = useState<UploadChoices>(() => ({
    ...NO_CHOICES,
    folderId: canChooseFolder ? initialFolder : null,
  }))
  // A link to Upload can name a folder; follow it when it changes.
  useEffect(() => {
    setChoices((current) => ({
      ...current,
      folderId: canChooseFolder ? initialFolder : null,
    }))
  }, [initialFolder, canChooseFolder])

  const profiles = useUploadProfiles()
  const folders = useFolders()
  const tags = useTags()

  const base = useMemo((): Required<UploadProfileOptions> => {
    const data = profiles.data
    if (choices.profileId === undefined)
      return data?.effective ?? saved.effective
    // A chosen profile without the list loaded can't happen: the list is how
    // it was chosen.
    const profile = data?.profiles.find(({ id }) => id === choices.profileId)
    return {
      ...UPLOAD_DEFAULTS,
      ...data?.accountOptions,
      ...profile?.options,
    }
  }, [choices.profileId, profiles.data, saved.effective])

  const effective = effectiveUpload(base, choices, canShare)
  const unpicked = effectiveUpload(base, NO_CHOICES, canShare)
  const folder = folders.folders.find(({ id }) => id === choices.folderId)
  const folderMissing = !!choices.folderId && !folder && !folders.loading
  // A password guards a public link; a private file needs none.
  const password = effective.visibility === 'PUBLIC' ? choices.password : ''
  const passwordProblem = password ? filePasswordHint(password) : null

  /** Why sending would fail, in words the person can act on. */
  const problem = passwordProblem
    ? 'Check the password.'
    : folderMissing
      ? folders.error
        ? 'Folders could not be loaded. Refresh the page and try again.'
        : 'That folder is no longer available. Choose another.'
      : effective.tagIds.length && !canTag
        ? 'Your upload profile adds tags, which your role can’t apply. Choose another profile.'
        : null

  return {
    choices,
    setChoices,
    /** Fields that reset after a paste; the rest stay for the next one. */
    clearPassword: () =>
      setChoices((current) => ({ ...current, password: '' })),
    effective,
    /** The same settings with nothing picked here. */
    unpicked,
    options: uploadOptionsFor({ ...choices, password }),
    problem,
    passwordProblem,
    /** Still finding out whether the chosen folder exists. */
    pending: !!choices.folderId && folders.loading,
    can: {
      share: canShare,
      chooseFolder: canChooseFolder,
      tag: canTag,
      chooseProfile: canChooseProfile,
    },
    saved,
    profiles,
    folders: { ...folders, selected: folder, missing: folderMissing },
    tags,
  }
}

export type UploadOptionsState = ReturnType<typeof useUploadOptions>
