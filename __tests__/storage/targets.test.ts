import { describe, expect, it } from 'vitest'

import { LocalStorageProvider } from '@/lib/storage/providers/local'
import { S3StorageProvider } from '@/lib/storage/providers/s3'
import {
  captureStorageTarget,
  parseStorageTarget,
  sameStorageTarget,
} from '@/lib/storage/targets'

describe('stored object provenance', () => {
  it('captures local fallback as local without consulting configured storage', () => {
    expect(captureStorageTarget(new LocalStorageProvider())).toEqual({
      provider: 'local',
    })
  })

  it('captures immutable S3 identity without credentials', () => {
    const config = {
      bucket: 'original-bucket',
      region: 'us-east-1',
      accessKeyId: 'fixture-key',
      secretAccessKey: 'fixture-secret',
    }
    const provider = new S3StorageProvider(config)
    config.bucket = 'replacement-bucket'
    expect(captureStorageTarget(provider)).toEqual({
      provider: 's3',
      bucket: 'original-bucket',
      region: 'us-east-1',
      endpoint: '',
      forcePathStyle: false,
    })
    expect(Object.isFrozen(provider.target)).toBe(true)
    expect(JSON.stringify(provider.target)).not.toContain('fixture-')
  })

  it('fails closed for unknown or contradictory provider identity', () => {
    for (const value of [null, {}, { provider: 's3', bucket: 'old' }])
      expect(parseStorageTarget(value)).toBeNull()
    expect(() =>
      captureStorageTarget({ kind: 's3', target: { provider: 'local' } })
    ).toThrow('actual target')
  })

  it('distinguishes every nonsecret S3 target setting', () => {
    const target = new S3StorageProvider({
      bucket: 'bucket',
      region: 'us-east-1',
      accessKeyId: 'fixture',
      secretAccessKey: 'fixture',
    }).target
    expect(sameStorageTarget(target, { ...target })).toBe(true)
    for (const change of [
      { bucket: 'another' },
      { region: 'us-west-2' },
      { endpoint: 'https://objects.example.test' },
      { forcePathStyle: true },
    ])
      expect(sameStorageTarget(target, { ...target, ...change })).toBe(false)
    expect(sameStorageTarget(target, { provider: 'local' })).toBe(false)
  })
})
