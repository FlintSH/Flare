import { hasPermission } from '@/lib/permissions/catalog'

import type { FlareConfig } from './index'

/** Saved size limits are in megabytes unless their unit is GB. */
export function sizeLimitBytes(limit: { value: number; unit: string }) {
  return limit.value * (limit.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
}

/** The largest file anyone may upload, in bytes. */
export function maxUploadBytes(config: FlareConfig) {
  return sizeLimitBytes(config.settings.general.storage.maxUploadSize)
}

/** An account's total storage allowance in bytes, or null when it has none. */
export function storageQuotaBytes(
  config: FlareConfig,
  access: { permissions?: readonly string[] }
): number | null {
  const { quotas } = config.settings.general.storage
  return quotas.enabled && !hasPermission(access, 'quotas.bypass')
    ? sizeLimitBytes(quotas.default)
    : null
}
