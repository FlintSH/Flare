import { User } from './user'

export interface ProfileClientProps {
  user: User
  quotasEnabled: boolean
  formattedQuota: string
  formattedUsed: string
  usagePercentage: number
  isAdmin: boolean
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

export interface ProfileExportProps {
  onExportStart: () => void
  onExportComplete: () => void
}

export interface ProfileToolsProps {
  user: User
}

export interface FlameshotFormValues {
  useWayland: boolean
  useCompositor: boolean
}

export interface SpectacleFormValues {
  scriptType: 'screenshot' | 'recording'
  useWayland: boolean
  includePointer: boolean
  captureMode: 'fullscreen' | 'current' | 'activewindow' | 'region'
  recordingMode: 'fullscreen' | 'current' | 'region'
  delay: number
}

export interface UploadToken {
  uploadToken: string | null
  isLoadingToken: boolean
  showToken: boolean
  setShowToken: (show: boolean) => void
  handleRefreshToken: () => Promise<void>
}
