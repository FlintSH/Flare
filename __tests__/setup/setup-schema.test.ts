import { describe, expect, it } from 'vitest'

import { setupAdminSchema, setupSchema } from '@/lib/setup/schema'
import { storageSettingsSchema } from '@/lib/storage/settings'

const admin = {
  name: 'admin',
  email: 'admin@example.test',
}
const s3 = {
  bucket: 'screenshots',
  region: 'us-east-1',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  endpoint: '',
}

function firstAdminError(input: unknown): string | null {
  const result = setupAdminSchema.safeParse(input)
  return result.success ? null : (result.error.issues[0]?.message ?? null)
}

describe('shared setup validation', () => {
  it.each([
    [{ ...admin, email: 'not-an-email' }, 'Enter a valid email address'],
    [{ ...admin, name: '  ' }, 'Username is required'],
  ])(
    'returns the same admin error for browser and server: %j',
    (input, error) => {
      expect(firstAdminError(input)).toBe(error)
      const result = setupSchema.safeParse({
        admin: input,
        storage: { provider: 's3', s3 },
        registrations: { enabled: true },
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toBe(error)
    }
  )

  it('normalizes identifiers, keeps S3 secrets as typed and holds no passphrase', () => {
    const result = setupSchema.parse({
      admin: {
        ...admin,
        name: ' admin ',
        email: ' admin@example.test ',
        // The wizard keeps the passphrase outside the form data. A field
        // that carries one is dropped here and refused by the server.
        passphrase: ' passphrase with spaces ',
        password: 'a password',
      },
      storage: {
        provider: 's3',
        s3: { ...s3, bucket: ' screenshots ', secretAccessKey: ' secret ' },
      },
      registrations: { enabled: true },
    })
    expect(result.admin).toEqual({
      name: 'admin',
      email: 'admin@example.test',
    })
    expect(result.storage.s3.bucket).toBe('screenshots')
    expect(result.storage.s3.secretAccessKey).toBe(' secret ')
    expect(result.storage.s3.forcePathStyle).toBe(false)
  })

  it.each(['bucket', 'region', 'accessKeyId', 'secretAccessKey'])(
    'requires %s only for S3 storage',
    (field) => {
      const input = { ...s3, [field]: ' ' }
      expect(
        storageSettingsSchema.safeParse({ provider: 'local', s3: input })
          .success
      ).toBe(true)
      const result = storageSettingsSchema.safeParse({
        provider: 's3',
        s3: input,
      })
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues[0].path).toEqual(['s3', field])
    }
  )

  it('accepts local storage without any S3 credentials', () => {
    expect(
      storageSettingsSchema.parse({
        provider: 'local',
        s3: {
          bucket: '',
          region: '',
          accessKeyId: '',
          secretAccessKey: '',
        },
      }).s3.forcePathStyle
    ).toBe(false)
  })

  it('allows switching to local storage with an unfinished S3 endpoint', () => {
    const storage = {
      provider: 's3',
      s3: { ...s3, endpoint: 'unfinished endpoint' },
    }
    const s3Result = storageSettingsSchema.safeParse(storage)
    expect(s3Result.success).toBe(false)
    if (!s3Result.success)
      expect(s3Result.error.issues[0].path).toEqual(['s3', 'endpoint'])

    storage.provider = 'local'
    expect(storageSettingsSchema.safeParse(storage).success).toBe(true)
    expect(
      setupSchema.safeParse({
        admin,
        storage,
        registrations: { enabled: false },
      }).success
    ).toBe(true)
  })

  it.each(['', 'https://s3.example.test', 'http://localhost:9000'])(
    'accepts optional HTTP(S) endpoint %s',
    (endpoint) => {
      expect(
        storageSettingsSchema.safeParse({
          provider: 's3',
          s3: { ...s3, endpoint },
        }).success
      ).toBe(true)
    }
  )

  it.each(['minio:9000', 'ftp://s3.example.test', 'not a url'])(
    'rejects unsupported endpoint %s before setup is committed',
    (endpoint) => {
      const result = storageSettingsSchema.safeParse({
        provider: 's3',
        s3: { ...s3, endpoint },
      })
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues[0].message).toBe(
          'Enter a valid HTTP or HTTPS endpoint URL'
        )
    }
  )
})
