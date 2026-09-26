import { redactEmailConfig } from '@/lib/email/config'

import { type Permission, hasPermission } from './catalog'

const sectionPermissions: Record<string, Permission> = {
  appearance: 'appearance.manage',
  advanced: 'administrator',
}
const generalPermissions: Record<string, Permission> = {
  storage: 'settings.storage',
  oidc: 'settings.security',
  registrations: 'settings.security',
  credits: 'settings.general',
  ocr: 'settings.general',
}
export function settingsPatchAllowed(
  subject: { permissions?: readonly string[] },
  settings: Record<string, unknown>
): boolean {
  return (
    Object.keys(settings).length > 0 &&
    Object.entries(settings).every(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
      if (key === 'general')
        return (
          Object.keys(value).length > 0 &&
          Object.keys(value).every(
            (field) =>
              generalPermissions[field] &&
              hasPermission(subject, generalPermissions[field])
          )
        )
      return Boolean(
        sectionPermissions[key] &&
        hasPermission(subject, sectionPermissions[key])
      )
    })
  )
}

/** Never serialize saved infrastructure credentials into a dashboard response. */
export function redactSettings(config: import('@/lib/config').FlareConfig) {
  return {
    ...config,
    settings: {
      ...config.settings,
      email: redactEmailConfig(config.settings.email),
      general: {
        ...config.settings.general,
        oidc: { ...config.settings.general.oidc, clientSecret: '' },
        storage: {
          ...config.settings.general.storage,
          s3: {
            ...config.settings.general.storage.s3,
            secretAccessKey: '',
            accessKeyId: '',
          },
        },
      },
    },
  }
}
