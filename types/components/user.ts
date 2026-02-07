import { ExpiryAction } from '@/types/events'

export interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  storageUsed: number
  role: 'ADMIN' | 'USER'
  randomizeFileUrls: boolean
  urlId: string
  vanityId: string | null
  fileCount: number
  shortUrlCount: number
  defaultFileExpiration: 'DISABLED' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | null
  defaultFileExpirationAction: 'DELETE' | 'SET_PRIVATE' | null
}

export interface ProfileClientProps {
  user: User
  quotasEnabled: boolean
  formattedQuota: string
  formattedUsed: string
  usagePercentage: number
  isAdmin: boolean
}

export interface PaginationData {
  current: number
  total: number
  totalPages: number
  perPage: number
}

export interface UsersResponse {
  users: User[]
  pagination: PaginationData
}

export interface UserFormData {
  name: string
  email: string
  role: 'ADMIN' | 'USER'
  quota?: number
}
