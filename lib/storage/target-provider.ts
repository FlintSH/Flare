import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
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
  const row = await prisma.config.findUnique({ where: { key: 'flare_config' } })
  const s3 = configSchema.parse(row?.value ?? DEFAULT_CONFIG).settings.general
    .storage.s3
  if (!sameStorageTarget(s3StorageTarget(s3), target))
    throw new StorageTargetChangedError()
  return new S3StorageProvider({ ...s3, endpoint: s3.endpoint || undefined })
}
