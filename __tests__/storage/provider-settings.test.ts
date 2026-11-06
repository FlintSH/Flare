import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG } from '@/lib/config'
import { loggers } from '@/lib/logger'
import {
  StorageSettingsError,
  createStorageProvider,
  getStorageProvider,
} from '@/lib/storage'
import {
  StorageTargetChangedError,
  getStorageProviderForTarget,
} from '@/lib/storage/target-provider'

const state = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: async () => state.config,
}))

const s3 = {
  bucket: 'files',
  region: 'us-east-1',
  accessKeyId: 'fixture-key',
  secretAccessKey: 'fixture-secret',
  endpoint: 'https://storage.example.test',
  forcePathStyle: true,
}
const target = {
  provider: 's3',
  bucket: s3.bucket,
  region: s3.region,
  endpoint: s3.endpoint,
  forcePathStyle: s3.forcePathStyle,
} as const

function save(storage: object) {
  const config = structuredClone(DEFAULT_CONFIG)
  Object.assign(config.settings.general.storage, storage)
  state.config = config
}

beforeEach(() => {
  vi.restoreAllMocks()
  save({ provider: 'local' })
})

describe('building a storage provider', () => {
  it.each([
    ['bucket', 'Bucket name is required'],
    ['secretAccessKey', 'Secret access key is required'],
  ])(
    'refuses S3 settings without %s instead of using local storage',
    (field, reason) => {
      expect(() =>
        createStorageProvider({ provider: 's3', s3: { ...s3, [field]: '' } })
      ).toThrow(new StorageSettingsError(reason))
    }
  )

  it('shares one provider in the process until the saved settings change', async () => {
    save({ provider: 's3', s3 })
    const first = await getStorageProvider()
    expect(first.kind).toBe('s3')
    expect(await getStorageProvider()).toBe(first)
    // Each route bundle loads its own copy of the module.
    vi.resetModules()
    const copy = await import('@/lib/storage')
    expect(await copy.getStorageProvider()).toBe(first)

    save({ provider: 's3', s3: { ...s3, bucket: 'other-files' } })
    const changed = await getStorageProvider()
    expect(changed).not.toBe(first)
    expect(changed.target).toMatchObject({ bucket: 'other-files' })
    save({ provider: 'local' })
    expect((await copy.getStorageProvider()).kind).toBe('local')
  })

  it('fails every call, logging the reason once, while saved S3 settings are incomplete', async () => {
    const logged = vi
      .spyOn(loggers.storage, 'error')
      .mockImplementation(() => {})
    save({ provider: 's3', s3: { ...s3, region: '' } })
    for (let call = 0; call < 3; call++)
      await expect(getStorageProvider()).rejects.toThrow(
        "The saved storage settings can't be used: Region is required"
      )
    expect(logged).toHaveBeenCalledTimes(1)
  })
})

describe('reaching a recorded S3 target', () => {
  it('uses the shared provider while S3 is the active storage', async () => {
    save({ provider: 's3', s3 })
    expect(await getStorageProviderForTarget(target)).toBe(
      await getStorageProvider()
    )
  })

  it('still reaches it with the saved S3 details after a switch to local storage', async () => {
    save({ provider: 'local', s3 })
    const provider = await getStorageProviderForTarget(target)
    expect(provider.kind).toBe('s3')
    expect(provider.target).toEqual(target)
    expect((await getStorageProvider()).kind).toBe('local')
  })

  it('matches files recorded before or after saves trimmed the settings', async () => {
    // Saved by an earlier version, which kept the spaces it was given.
    const spaced = {
      ...s3,
      bucket: ' files',
      region: 'us-east-1 ',
      endpoint: ' https://storage.example.test ',
    }
    save({ provider: 's3', s3: spaced })
    const provider = await getStorageProvider()
    // New files record what the provider uses: the trimmed values.
    expect(provider.target).toEqual(target)
    expect(await getStorageProviderForTarget(target)).toBe(provider)
    const recordedBefore = {
      ...target,
      bucket: spaced.bucket,
      region: spaced.region,
      endpoint: spaced.endpoint,
    }
    expect(await getStorageProviderForTarget(recordedBefore)).toBe(provider)
    // A save now trims them, and records written before that still match.
    save({ provider: 's3', s3 })
    expect(await getStorageProviderForTarget(recordedBefore)).toBe(
      await getStorageProvider()
    )
  })

  it('refuses a target the saved S3 details no longer describe', async () => {
    save({ provider: 's3', s3: { ...s3, bucket: 'other-files' } })
    await expect(getStorageProviderForTarget(target)).rejects.toBeInstanceOf(
      StorageTargetChangedError
    )
  })
})
