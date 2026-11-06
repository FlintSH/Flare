import type { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import type { z } from 'zod'

import { apiRequest } from '@/lib/client/request'

/** The fields `PUT /api/profile` accepts. */
export type ProfilePatch = z.input<typeof UpdateProfileSchema>

/** Saves the given fields of your own account and returns the saved profile. */
export function updateProfile(patch: ProfilePatch, fallback?: string) {
  return apiRequest<ProfileResponse>('/api/profile', {
    method: 'PUT',
    body: patch,
    fallback,
  })
}
