import { VanityIdSchema } from '@/types/dto/user'
import { z } from 'zod'

import {
  accountEmailSchema,
  accountNameSchema,
  accountPasswordSchema,
} from '@/lib/users/account-policy'

// No `image`: only POST /api/profile/avatar checks and stores an avatar, so
// an `image` field here is dropped like any other unknown field.
export const UpdateProfileSchema = z.object({
  name: accountNameSchema.optional(),
  email: accountEmailSchema.optional(),
  currentPassword: z.string().max(256).optional(),
  securityCode: z.string().max(80).optional(),
  newPassword: accountPasswordSchema.optional(),
  randomizeFileUrls: z.boolean().optional(),
  defaultFileExpiration: z
    .enum(['DISABLED', 'HOUR', 'DAY', 'WEEK', 'MONTH'])
    .optional(),
  defaultFileExpirationAction: z.enum(['DELETE', 'SET_PRIVATE']).optional(),
  vanityId: VanityIdSchema.nullable().optional(),
})

export interface ProfileResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  randomizeFileUrls: boolean
  vanityId: string | null
}
