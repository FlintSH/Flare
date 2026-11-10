export interface PublicSettings {
  version: string
  /**
   * What a client needs to know before it uploads: the protocol versions
   * this server accepts from a script client (docs/e2ee-spec.md, section
   * 1.5.3, rule 5), and whether the administrator forbids plain uploads.
   */
  encryption: {
    protocolVersions: number[]
    forbidPlainUploads: boolean
  }
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
