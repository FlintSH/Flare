import type { PersonalAppearance } from '@/lib/customization/schema'
import type { PROFILE_SECTIONS } from '@/lib/preferences/navigation'

export interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  storageUsed: number
  roles: import('@/lib/permissions/catalog').RoleSummary[]
  permissions: string[]
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
  initialSection: (typeof PROFILE_SECTIONS)[number]
  initialPreference: PersonalAppearance
}

export interface ProfileStorageProps {
  quotasEnabled: boolean
  formattedQuota: string
  formattedUsed: string
  usagePercentage: number
  fileCount: number
  shortUrlCount: number
}

export interface ProfileAccountProps {
  user: User
  onUpdate: () => void
}

export interface ProfileSecurityProps {
  onUpdate: () => void
}

export interface UploadToken {
  uploadToken: string | null
  isLoadingToken: boolean
  showToken: boolean
  setShowToken: (show: boolean) => void
  handleLoadToken: () => Promise<void>
  handleRefreshToken: () => Promise<void>
}
