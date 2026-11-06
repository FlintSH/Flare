import { describe, expect, it } from 'vitest'

import type { FlareConfig } from '@/lib/config'
import { defaultQuotaBytes, maxUploadBytes } from '@/lib/config/limits'
import {
  assertFits,
  storageQuotaBytes,
  uploadCapacity,
} from '@/lib/uploads/capacity'
import { bytesToMB, formatFileSize, mbToBytes } from '@/lib/utils/size'

const MB = 1024 ** 2

function config(
  quotas: { enabled: boolean; value: number; unit: string },
  maxUpload = { value: 10, unit: 'MB' }
) {
  return {
    settings: {
      general: {
        storage: {
          maxUploadSize: maxUpload,
          quotas: {
            enabled: quotas.enabled,
            default: { value: quotas.value, unit: quotas.unit },
          },
        },
      },
    },
  } as unknown as FlareConfig
}

const member = { permissions: ['files.upload'] }
const quota = config({ enabled: true, value: 1, unit: 'MB' })

describe('upload capacity', () => {
  it('reads the saved limits in binary units', () => {
    expect(maxUploadBytes(quota)).toBe(10 * MB)
    expect(
      maxUploadBytes(
        config(
          { enabled: false, value: 1, unit: 'GB' },
          { value: 2, unit: 'GB' }
        )
      )
    ).toBe(2 * 1024 * MB)
    expect(defaultQuotaBytes(quota)).toBe(MB)
    expect(
      defaultQuotaBytes(config({ enabled: false, value: 1, unit: 'MB' }))
    ).toBeNull()
  })

  it('exempts quotas.bypass and administrators from the quota, not from the size limit', () => {
    expect(storageQuotaBytes(quota, member)).toBe(MB)
    for (const permissions of [['quotas.bypass'], ['administrator']]) {
      expect(storageQuotaBytes(quota, { permissions })).toBeNull()
      expect(uploadCapacity(quota, { permissions }, 5)).toEqual({
        fileBytes: 10 * MB,
        quotaBytes: Infinity,
      })
    }
  })

  it('counts the quota left from the megabytes an account stores', () => {
    expect(uploadCapacity(quota, member, bytesToMB(700_000))).toEqual({
      fileBytes: 10 * MB,
      quotaBytes: MB - 700_000,
    })
    // An account over a lowered quota has less than nothing left.
    expect(uploadCapacity(quota, member, 2).quotaBytes).toBe(-MB)
    expect(
      uploadCapacity(quota, member, 0, { fileBytes: 2 * MB }).fileBytes
    ).toBe(2 * MB)
  })

  it('refuses a file over either limit with one message per limit', () => {
    const capacity = uploadCapacity(quota, member, bytesToMB(700_000))
    expect(() => assertFits(capacity, MB - 700_000)).not.toThrow()
    expect(() => assertFits(capacity, MB - 700_000 + 1)).toThrow(
      expect.objectContaining({
        status: 413,
        message: 'This would exceed your storage quota.',
      })
    )
    expect(() => assertFits(capacity, 10 * MB + 1)).toThrow(
      expect.objectContaining({
        status: 413,
        message: 'A file exceeds the upload size limit.',
      })
    )
  })

  it('checks several files against the size limit each and the quota together', () => {
    const capacity = uploadCapacity(quota, member, 0)
    expect(() => assertFits(capacity, [600_000, 400_000])).not.toThrow()
    expect(() => assertFits(capacity, [600_000, 600_000])).toThrow(
      'This would exceed your storage quota.'
    )
    expect(() => assertFits(capacity, [10, 10 * MB + 1])).toThrow(
      'A file exceeds the upload size limit.'
    )
    expect(() => assertFits(capacity, [])).not.toThrow()
    // Even an empty file is refused once an account is over its quota.
    expect(() => assertFits(uploadCapacity(quota, member, 2), 0)).toThrow(
      'This would exceed your storage quota.'
    )
  })
})

describe('recorded sizes', () => {
  it('converts between bytes and the megabytes files and accounts record', () => {
    expect(mbToBytes(bytesToMB(700_000))).toBe(700_000)
    expect(bytesToMB(MB)).toBe(1)
    expect(formatFileSize(bytesToMB(1536))).toBe('1.50 KB')
    expect(formatFileSize(0)).toBe('0 B')
  })
})
