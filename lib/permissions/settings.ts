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
/**
 * The MCP server's fields each have their own permission: turning it on opens
 * an endpoint agents authenticate to, the same class of change as
 * registration and OIDC. Letting agents administer the instance is for an
 * administrator alone.
 */
const mcpPermissions: Record<string, Permission> = {
  enabled: 'settings.security',
  administration: 'administrator',
}
function mcpPatchAllowed(
  subject: { permissions?: readonly string[] },
  value: unknown
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = Object.keys(value)
  return (
    fields.length > 0 &&
    fields.every(
      (field) =>
        Object.hasOwn(mcpPermissions, field) &&
        hasPermission(subject, mcpPermissions[field])
    )
  )
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
          Object.entries(value).every(([field, fieldValue]) =>
            field === 'mcp'
              ? mcpPatchAllowed(subject, fieldValue)
              : generalPermissions[field] &&
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

/**
 * The permission one settings field needs, as `settingsPatchAllowed` decides
 * it, by its dotted path: `general.storage`, `general.mcp.enabled`,
 * `appearance.theme`. Fields of `general` and `general.mcp` have their own;
 * any other section has one for all of it. Undefined for a field nobody may
 * change through a settings patch.
 */
export function settingsFieldPermission(path: string): Permission | undefined {
  const [section, field, subfield] = path.split('.')
  const own = (table: Record<string, Permission>, key: string | undefined) =>
    key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined
  if (section === 'general')
    return field === 'mcp'
      ? own(mcpPermissions, subfield)
      : own(generalPermissions, field)
  return own(sectionPermissions, section)
}
