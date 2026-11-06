import { type FlareConfig, getConfig } from '@/lib/config'
import { loggers } from '@/lib/logger'

import { LocalStorageProvider } from './providers/local'
import { S3StorageProvider } from './providers/s3'
import { storageSettingsSchema } from './settings'
import type { StorageProvider } from './types'

const logger = loggers.storage

export type { StorageProvider, RangeOptions } from './types'
export { LocalStorageProvider, S3StorageProvider }

type SavedStorage = Pick<
  FlareConfig['settings']['general']['storage'],
  'provider' | 's3'
>

/** Saved storage settings no provider can be built from, such as S3 without a bucket. */
export class StorageSettingsError extends Error {
  constructor(reason: string) {
    super(`The saved storage settings can't be used: ${reason}`)
    this.name = 'StorageSettingsError'
  }
}

/** Settings it can't use throw; no other backend stands in. */
export function createStorageProvider(storage: SavedStorage): StorageProvider {
  const settings = storageSettingsSchema.safeParse(storage)
  if (!settings.success)
    throw new StorageSettingsError(settings.error.issues[0].message)
  const { provider, s3 } = settings.data
  return provider === 's3'
    ? new S3StorageProvider({ ...s3, endpoint: s3.endpoint || undefined })
    : new LocalStorageProvider()
}

type ProviderSlot = { settings: string } & (
  { provider: StorageProvider } | { error: unknown }
)

// Route bundles each load their own copy of this module; the process keeps
// one provider for the saved settings.
const slotKey = Symbol.for('flare.storage.provider')
const processState = globalThis as typeof globalThis & {
  [slotKey]?: ProviderSlot
}

/**
 * The provider for the saved storage settings `storage`, shared by the whole
 * process and rebuilt on the first call after a save changes them. Settings
 * that can't be used throw on every call and are logged once.
 */
export function savedStorageProvider(storage: SavedStorage): StorageProvider {
  const settings = JSON.stringify([storage.provider, storage.s3])
  let slot = processState[slotKey]
  if (slot?.settings !== settings) {
    try {
      slot = { settings, provider: createStorageProvider(storage) }
      logger.info(`Using ${storage.provider} storage`, {
        ...(storage.provider === 's3' && {
          bucket: storage.s3.bucket,
          region: storage.s3.region,
          endpoint: storage.s3.endpoint,
        }),
      })
    } catch (error) {
      logger.error('Storage is unavailable until its settings are fixed', error)
      slot = { settings, error }
    }
    processState[slotKey] = slot
  }
  if ('error' in slot) throw slot.error
  return slot.provider
}

export async function getStorageProvider(): Promise<StorageProvider> {
  return savedStorageProvider((await getConfig()).settings.general.storage)
}
