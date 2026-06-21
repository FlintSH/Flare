import { getConfig } from '@/lib/config'

/**
 * Whether the instance-wide organization feature (folders & tags) is enabled.
 * When disabled, all organization APIs and UI are hidden so Flare behaves as a
 * pure screenshot host.
 */
export async function isOrganizationEnabled(): Promise<boolean> {
  const config = await getConfig()
  return config.settings.general.organization.enabled
}
