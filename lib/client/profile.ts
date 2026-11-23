import type { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import type { z } from 'zod'

import { apiRequest } from '@/lib/client/request'

/** The fields `PUT /api/profile` accepts. */
export type ProfilePatch = z.input<typeof UpdateProfileSchema>

/**
 * Writes to the account's upload defaults from this tab, counted, so an Undo
 * offered after one write can tell a later one happened (from any page).
 */
export const defaultsWritten = { expiry: 0, profile: 0 }

export function updateProfile(patch: ProfilePatch, fallback?: string) {
  const touchesExpiry =
    'defaultFileExpiration' in patch || 'defaultFileExpirationAction' in patch
  // Counted as it starts, so an Undo offered earlier stands down even while
  // this one is still on its way (if it then fails, that Undo just says
  // nothing was undone).
  if (touchesExpiry) defaultsWritten.expiry += 1
  return apiRequest<ProfileResponse>('/api/profile', {
    method: 'PUT',
    body: patch,
    fallback,
  })
}

/** Makes a profile (or none) the account's default upload profile. */
export function setDefaultProfile(
  profileId: string | null,
  fallback = 'Your default profile couldn’t be changed.'
) {
  defaultsWritten.profile += 1
  return apiRequest('/api/upload-profiles/default', {
    method: 'PUT',
    body: { profileId },
    fallback,
  })
}
