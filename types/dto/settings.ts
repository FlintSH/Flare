import { FlareConfig } from '@/lib/config'

/**
 * Settings DTO Types
 */

// Public settings visible to non-admin users
export interface PublicSettings {
  version: string
  settings: {
    general: {
      registrations: {
        enabled: boolean
        disabledMessage: string | null
      }
    }
    appearance: {
      theme: string
      favicon: string | null
      customColors: Record<string, string> | null
    }
    advanced: {
      customCSS: string
      customHead: string
    }
  }
}

// Request to update a specific section of settings
export interface UpdateSettingSectionRequest<
  T extends keyof FlareConfig['settings'],
> {
  section: T
  data: Partial<FlareConfig['settings'][T]>
}

// Response for settings update
export interface SettingsUpdateResponse {
  message: string
}
