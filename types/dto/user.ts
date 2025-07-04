import { z } from 'zod'

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

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
