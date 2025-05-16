import { z } from 'zod'

/**
 * Profile DTO Types
 */

// Profile update request schema
export const UpdateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
  image: z.string().optional(),
  randomizeFileUrls: z.boolean().optional(),
})

export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>

// Profile response
export interface ProfileResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  randomizeFileUrls: boolean
}
