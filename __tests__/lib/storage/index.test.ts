import { getConfig } from '@/lib/config'
import {
  LocalStorageProvider,
  S3StorageProvider,
  getStorageProvider,
  invalidateStorageProvider,
} from '@/lib/storage'

// Mock dependencies
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}))

jest.mock('@/lib/storage/providers/local', () => ({
  LocalStorageProvider: jest.fn(),
}))

jest.mock('@/lib/storage/providers/s3', () => ({
  S3StorageProvider: jest.fn(),
}))

describe('Storage Provider Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    invalidateStorageProvider()
  })

  describe('getStorageProvider', () => {
    it('should return LocalStorageProvider when provider is local', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            storage: {
              provider: 'local',
              s3: {},
            },
          },
        },
      })

      await getStorageProvider()
      expect(LocalStorageProvider).toHaveBeenCalled()
      expect(S3StorageProvider).not.toHaveBeenCalled()
    })

    it('should return S3StorageProvider when provider is s3', async () => {
      const s3Config = {
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        endpoint: 'http://localhost:4566',
        forcePathStyle: true,
      }

      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            storage: {
              provider: 's3',
              s3: s3Config,
            },
          },
        },
      })

      await getStorageProvider()
      expect(S3StorageProvider).toHaveBeenCalledWith(s3Config)
      expect(LocalStorageProvider).not.toHaveBeenCalled()
    })

    it('should fallback to LocalStorageProvider when S3 initialization fails', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            storage: {
              provider: 's3',
              s3: {
                bucket: 'test-bucket',
                region: 'us-east-1',
                accessKeyId: 'test-key',
                secretAccessKey: 'test-secret',
              },
            },
          },
        },
      })
      ;(S3StorageProvider as jest.Mock).mockImplementation(() => {
        throw new Error('S3 initialization failed')
      })

      await getStorageProvider()
      expect(S3StorageProvider).toHaveBeenCalled()
      expect(LocalStorageProvider).toHaveBeenCalled()
    })

    it('should cache and reuse the storage provider', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            storage: {
              provider: 'local',
              s3: {},
            },
          },
        },
      })

      const provider1 = await getStorageProvider()
      const provider2 = await getStorageProvider()

      expect(provider1).toBe(provider2)
      expect(LocalStorageProvider).toHaveBeenCalledTimes(1)
    })

    it('should create new provider after invalidation', async () => {
      ;(getConfig as jest.Mock).mockResolvedValue({
        settings: {
          general: {
            storage: {
              provider: 'local',
              s3: {},
            },
          },
        },
      })

      const provider1 = await getStorageProvider()
      invalidateStorageProvider()
      const provider2 = await getStorageProvider()

      expect(provider1).not.toBe(provider2)
      expect(LocalStorageProvider).toHaveBeenCalledTimes(2)
    })
  })
})
