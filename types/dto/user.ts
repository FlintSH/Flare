import { z } from 'zod'

import type { RoleSummary } from '@/lib/permissions/catalog'
import {
  accountEmailSchema,
  accountNameSchema,
  accountPasswordSchema,
} from '@/lib/users/account-policy'
import { urlIdSchema, vanityIdSchema } from '@/lib/users/public-id'

export const UserSchema = z
  .object({
    id: z.string().optional(),
    name: accountNameSchema,
    email: accountEmailSchema,
    password: accountPasswordSchema.optional(),
    roleIds: z.array(z.string().min(1).max(128)).max(100).optional(),
    urlId: urlIdSchema.optional(),
    // Empty form fields clear the vanity URL; omitted fields leave it unchanged.
    vanityId: vanityIdSchema
      .or(z.literal('').transform(() => null))
      .nullable()
      .optional(),
  })
  .strict()

export interface UserResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  roles: RoleSummary[]
  urlId: string
  vanityId: string | null
  storageUsed: number
  /** Listed accounts only: who created the invite this account joined with. */
  invitedBy?: { id: string; name: string | null } | null
  _count: {
    files: number
    shortenedUrls: number
  }
}
