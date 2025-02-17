import { getConfig } from '../config/index'
import { LocalStorageProvider } from './providers/local'
import { S3StorageProvider } from './providers/s3'
import type { StorageProvider } from './types'

export type { StorageProvider, RangeOptions } from './types'
export { LocalStorageProvider, S3StorageProvider }

let storageProvider: StorageProvider | null = null

export async function getStorageProvider(): Promise<StorageProvider> {
  if (storageProvider) return storageProvider

  const config = await getConfig()
  const { provider, s3 } = config.settings.general.storage

  if (provider === 's3') {
    try {
      storageProvider = new S3StorageProvider({
        bucket: s3.bucket,
        region: s3.region,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        endpoint: s3.endpoint || undefined,
        forcePathStyle: s3.forcePathStyle,
      })
    } catch (error) {
      console.error('Failed to initialize S3 storage provider:', error)
      console.warn('Falling back to local storage')
      storageProvider = new LocalStorageProvider()
    }
  } else {
    storageProvider = new LocalStorageProvider()
  }

  return storageProvider
}

// Reset the storage provider when settings change
export function invalidateStorageProvider(): void {
  storageProvider = null
}
