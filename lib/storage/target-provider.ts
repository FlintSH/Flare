import { readConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import { LocalStorageProvider } from './providers/local'
import { S3StorageProvider } from './providers/s3'
import { s3StorageTarget, sameStorageTarget } from './targets'
import type { StorageTarget } from './targets'
import type { StorageProvider } from './types'

export class StorageTargetChangedError extends Error {}

/** Resolve recorded provenance with current credentials and no backend fallback. */
export async function getStorageProviderForTarget(
  target: StorageTarget
): Promise<StorageProvider> {
  if (target.provider === 'local') return new LocalStorageProvider()
  const { s3 } = (await readConfig(prisma)).settings.general.storage
  if (!sameStorageTarget(s3StorageTarget(s3), target))
    throw new StorageTargetChangedError()
  return new S3StorageProvider({ ...s3, endpoint: s3.endpoint || undefined })
}
