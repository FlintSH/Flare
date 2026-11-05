import type { PublicSettings } from '@/types/dto/settings'

import { redactEmailConfig } from '@/lib/email/schema'

import type { FlareConfig } from './index'

/**
 * Saved credentials. They never leave the server, so a client sends them back
 * blank, and a blank submission keeps the saved value.
 */
const MASKED_FIELDS = [
  ['general', 'oidc', 'clientSecret'],
  ['general', 'storage', 's3', 'accessKeyId'],
  ['general', 'storage', 's3', 'secretAccessKey'],
] as const

function maskedField(settings: unknown, path: readonly string[]) {
  let parent = settings
  for (const key of path.slice(0, -1))
    parent =
      parent && typeof parent === 'object'
        ? (parent as Record<string, unknown>)[key]
        : undefined
  return parent && typeof parent === 'object'
    ? { parent: parent as Record<string, unknown>, key: path[path.length - 1] }
    : null
}

/** The settings an administrator's browser may see, with every credential blank. */
export function redactSettings(config: FlareConfig): FlareConfig {
  const redacted = structuredClone(config)
  for (const path of MASKED_FIELDS) {
    const field = maskedField(redacted.settings, path)
    if (field) field.parent[field.key] = ''
  }
  redacted.settings.email = redactEmailConfig(redacted.settings.email)
  return redacted
}

/** Drop blank credentials from a submitted settings update so the saved ones stay. */
export function keepSavedCredentials(settings: Record<string, unknown>) {
  for (const path of MASKED_FIELDS) {
    const field = maskedField(settings, path)
    if (field?.parent[field.key] === '') delete field.parent[field.key]
  }
}

/** What anyone, signed in or not, may read about the instance's settings. */
export function publicSettings(config: FlareConfig): PublicSettings {
  return {
    version: config.version,
    settings: {
      general: {
        registrations: {
          enabled: config.settings.general.registrations.enabled,
          disabledMessage:
            config.settings.general.registrations.disabledMessage,
        },
      },
      appearance: {
        theme: config.settings.appearance.theme,
        favicon: config.settings.appearance.favicon,
        customColors: config.settings.appearance.customColors,
      },
      advanced: {
        customCSS: config.settings.advanced.customCSS,
        customHead: config.settings.advanced.customHead,
      },
    },
  }
}
