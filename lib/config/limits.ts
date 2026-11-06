import type { FlareConfig } from './index'

/** Saved size limits are in megabytes unless their unit is GB. */
export function sizeLimitBytes(limit: { value: number; unit: string }) {
  return limit.value * (limit.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
}

/** The largest file anyone may upload, in bytes. */
export function maxUploadBytes(config: FlareConfig) {
  return sizeLimitBytes(config.settings.general.storage.maxUploadSize)
}

/** The storage allowance accounts get, in bytes, or null when quotas are off. */
export function defaultQuotaBytes(config: FlareConfig): number | null {
  const { quotas } = config.settings.general.storage
  return quotas.enabled ? sizeLimitBytes(quotas.default) : null
}
