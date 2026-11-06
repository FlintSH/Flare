import { getConfig } from '@/lib/config'

import { createStorageProvider, savedStorageProvider } from './index'
import { LocalStorageProvider } from './providers/local'
import { s3StorageTarget, sameStorageTarget } from './targets'
import type { StorageTarget } from './targets'
import type { StorageProvider } from './types'

export class StorageTargetChangedError extends Error {}

/** Resolve recorded provenance with current credentials and no backend fallback. */
export async function getStorageProviderForTarget(
  target: StorageTarget
): Promise<StorageProvider> {
  if (target.provider === 'local') return new LocalStorageProvider()
  const { storage } = (await getConfig()).settings.general
  if (!sameStorageTarget(s3StorageTarget(storage.s3), target))
    throw new StorageTargetChangedError()
  // After a switch to local storage, the saved S3 details still reach the
  // files recorded there.
  return storage.provider === 's3'
    ? savedStorageProvider(storage)
    : createStorageProvider({ ...storage, provider: 's3' })
}
