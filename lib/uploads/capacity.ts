import type { FlareConfig } from '@/lib/config'
import { defaultQuotaBytes, maxUploadBytes } from '@/lib/config/limits'
import { HttpError } from '@/lib/http/errors'
import {
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'
import { mbToBytes } from '@/lib/utils/size'

/** An account's total storage allowance in bytes, or null when it has none. */
export function storageQuotaBytes(
  config: FlareConfig,
  access: PermissionSubject
): number | null {
  return hasPermission(access, 'quotas.bypass')
    ? null
    : defaultQuotaBytes(config)
}

/** What an account may still upload, in bytes. */
export interface UploadCapacity {
  /** The most one file may hold. */
  fileBytes: number
  /**
   * What the quota has left: Infinity without a quota, below zero when the
   * account already stores more than it allows.
   */
  quotaBytes: number
}

/**
 * What an account storing `usedMb` megabytes may still upload. Files are held
 * to the instance's upload size limit unless a kind of upload has its own.
 */
export function uploadCapacity(
  config: FlareConfig,
  access: PermissionSubject,
  usedMb: number,
  { fileBytes = maxUploadBytes(config) }: { fileBytes?: number } = {}
): UploadCapacity {
  const quota = storageQuotaBytes(config, access)
  return {
    fileBytes,
    quotaBytes: quota === null ? Infinity : quota - mbToBytes(usedMb),
  }
}

export function overCapacity(limit: 'size' | 'quota') {
  return new HttpError(
    413,
    limit === 'size'
      ? 'A file exceeds the upload size limit.'
      : 'This would exceed your storage quota.'
  )
}

/**
 * Refuses files that don't fit: any one larger than the size limit, or all of
 * them together more than the quota has left.
 */
export function assertFits(
  capacity: UploadCapacity,
  sizes: number | readonly number[]
) {
  const files = typeof sizes === 'number' ? [sizes] : sizes
  if (files.some((size) => size > capacity.fileBytes))
    throw overCapacity('size')
  if (files.reduce((total, size) => total + size, 0) > capacity.quotaBytes)
    throw overCapacity('quota')
}
