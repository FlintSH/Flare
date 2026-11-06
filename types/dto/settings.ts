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

export interface SettingsUpdateResponse {
  message: string
}
