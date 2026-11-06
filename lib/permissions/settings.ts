import { type Permission, hasPermission } from './catalog'

const sectionPermissions: Record<string, Permission> = {
  appearance: 'appearance.manage',
  advanced: 'administrator',
}
/** Who may see and change custom CSS and head HTML, the `advanced` section. */
export const CUSTOM_STYLES_PERMISSION = sectionPermissions.advanced

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
