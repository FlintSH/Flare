import { z } from 'zod'

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

/**
 * Reserved route paths that cannot be used as vanity IDs.
 * These correspond to existing route segments in the application.
 */
export const RESERVED_VANITY_IDS = [
  'api',
  'auth',
  'dashboard',
  'admin',
  'settings',
  'setup',
  'raw',
  'direct',
  'u',
  'profile',
  'avatars',
  '_next',
] as const

/**
 * Vanity ID validation schema.
 * 3-32 characters, alphanumeric + hyphens, no leading/trailing hyphens.
 */
export const VanityIdSchema = z
  .string()
  .min(3, 'Vanity URL must be at least 3 characters')
  .max(32, 'Vanity URL must be at most 32 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/,
    'Vanity URL must start and end with alphanumeric characters and can contain hyphens'
  )
  .refine(
    (val) =>
      !RESERVED_VANITY_IDS.includes(
        val.toLowerCase() as (typeof RESERVED_VANITY_IDS)[number]
      ),
    'This URL path is reserved and cannot be used'
  )

export const UserSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  role: z.enum(['ADMIN', 'USER']),
  urlId: z
    .string()
    .regex(/^[A-Za-z0-9]{5}$/, 'URL ID must be 5 alphanumeric characters')
    .optional(),
  vanityId: VanityIdSchema.nullable().optional(),
})

export type CreateUserRequest = Omit<z.infer<typeof UserSchema>, 'id'>
export type UpdateUserRequest = z.infer<typeof UserSchema>

export interface UserResponse {
  id: string
  name: string | null
  email: string | null
  image: string | null
  role: string
  urlId: string
  vanityId: string | null
  storageUsed: number
  _count: {
    files: number
    shortenedUrls: number
  }
}

export interface UserListResponse {
  users: UserResponse[]
  pagination: {
    total: number
    pages: number
    page: number
    limit: number
  }
}
