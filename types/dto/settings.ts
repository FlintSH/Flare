import { FlareConfig } from '@/lib/config'

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

export interface UpdateSettingSectionRequest<
  T extends keyof FlareConfig['settings'],
> {
  section: T
  data: Partial<FlareConfig['settings'][T]>
}

export interface SettingsUpdateResponse {
  message: string
}
