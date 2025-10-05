import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
  image: z.string().optional(),
  randomizeFileUrls: z.boolean().optional(),
  enableRichEmbeds: z.boolean().optional(),
  defaultFileExpiration: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH']).optional(),
  defaultFileExpirationAction: z.enum(['DELETE', 'SET_PRIVATE']).optional(),
})

export type UpdateProfileRequest = z.infer<typeof UpdateProfileSchema>

export interface ProfileResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  randomizeFileUrls: boolean
  enableRichEmbeds: boolean
}
