import { afterAll, beforeAll, describe } from 'vitest'

import { S3StorageProvider } from '@/lib/storage/providers/s3'

import { createInMemoryS3 } from './helpers/in-memory-s3'
import { runStorageProviderContract } from './provider-contract'

// The in-memory backend replaces every S3Client's requests, so it must be gone
// before the real-endpoint run below starts. Unique per-test paths keep tests
// isolated.
describe('in-memory S3 backend', () => {
  let s3: ReturnType<typeof createInMemoryS3>
  beforeAll(() => {
    s3 = createInMemoryS3()
  })
  afterAll(() => {
    s3.restore()
  })

  runStorageProviderContract('s3 (in-memory)', async () => {
    const provider = new S3StorageProvider({
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    })

    return {
      provider,
      prefix: 'uploads/contract',
      cleanup: async () => {
        // Data persists across tests (unique paths avoid collisions); nothing
        // to tear down between cases.
      },
    }
  })
})

// Opt-in run against a real S3-compatible endpoint (AWS, MinIO, etc.). Set the
// TEST_S3_* env vars to enable; this validates the full path including
// multipart uploads. Example:
//   TEST_S3_ENDPOINT=http://localhost:9000 TEST_S3_BUCKET=flare-test \
//   TEST_S3_REGION=us-east-1 TEST_S3_ACCESS_KEY=... TEST_S3_SECRET_KEY=... \
//   TEST_S3_FORCE_PATH_STYLE=true pnpm test
const realS3Configured = Boolean(
  process.env.TEST_S3_BUCKET &&
  process.env.TEST_S3_REGION &&
  process.env.TEST_S3_ACCESS_KEY &&
  process.env.TEST_S3_SECRET_KEY
)

if (realS3Configured) {
  runStorageProviderContract('s3 (real endpoint)', async () => {
    const provider = new S3StorageProvider({
      bucket: process.env.TEST_S3_BUCKET as string,
      region: process.env.TEST_S3_REGION as string,
      accessKeyId: process.env.TEST_S3_ACCESS_KEY as string,
      secretAccessKey: process.env.TEST_S3_SECRET_KEY as string,
      endpoint: process.env.TEST_S3_ENDPOINT || undefined,
      forcePathStyle: process.env.TEST_S3_FORCE_PATH_STYLE === 'true',
    })

    return {
      provider,
      prefix: `uploads/contract-${Date.now()}`,
      cleanup: async () => {
        // Objects live under a unique per-run prefix in a dedicated test
        // bucket; no teardown required between cases.
      },
    }
  })
}
