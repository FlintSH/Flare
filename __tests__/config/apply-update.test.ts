import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

import {
  ConfigValidationError,
  DEFAULT_CONFIG,
  applyConfigUpdate,
} from '@/lib/config'
import { HttpError } from '@/lib/http/errors'

vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))

/** A partial settings change, as a request submits it. */
const change = (settings: unknown) =>
  ({ settings }) as Parameters<typeof applyConfigUpdate>[1]

/** A transaction whose saved settings are `value`; it records what is saved. */
function transaction(value: unknown) {
  const saved: unknown[] = []
  const tx = {
    $executeRaw: vi.fn(),
    config: {
      findUnique: async () => ({ key: 'flare_config', value }),
      upsert: async ({ update }: { update: { value: unknown } }) => {
        saved.push(update.value)
      },
    },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, saved }
}

describe('saving a settings change', () => {
  it('refuses a submitted value the schema rejects with a 400 for the person saving', async () => {
    const { tx, saved } = transaction(structuredClone(DEFAULT_CONFIG))
    const failure = await applyConfigUpdate(
      tx,
      change({ general: { registrations: { enabled: 'yes' } } })
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ConfigValidationError)
    expect(failure).toBeInstanceOf(HttpError)
    expect(failure).toMatchObject({
      status: 400,
      message: 'Could not update settings. Check the values and try again.',
    })
    expect(saved).toEqual([])
  })

  it('leaves saved settings the schema rejects to the server, not the person saving', async () => {
    const { tx } = transaction({ version: 1, settings: 'broken' })
    const failure = await applyConfigUpdate(
      tx,
      change({ general: { registrations: { enabled: true } } })
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ZodError)
  })

  it('saves a valid change', async () => {
    const { tx, saved } = transaction(structuredClone(DEFAULT_CONFIG))
    await applyConfigUpdate(
      tx,
      change({ general: { registrations: { enabled: false } } })
    )
    expect(saved).toHaveLength(1)
  })
})

describe('saving storage settings', () => {
  const s3 = {
    bucket: 'files',
    region: 'us-east-1',
    accessKeyId: 'saved-key',
    secretAccessKey: 'saved-secret',
    endpoint: '',
    forcePathStyle: false,
  }
  const withStorage = (storage: object) => {
    const config = structuredClone(DEFAULT_CONFIG)
    Object.assign(config.settings.general.storage, storage)
    return config
  }
  type Saved = typeof DEFAULT_CONFIG

  it.each([
    [{ provider: 's3' }, 'Bucket name is required'],
    [{ provider: 's3', s3: { ...s3, region: ' ' } }, 'Region is required'],
    [
      { provider: 's3', s3: { ...s3, endpoint: 'not a url' } },
      'Enter a valid HTTP or HTTPS endpoint URL',
    ],
  ])(
    'refuses S3 storage the provider could not use: %j',
    async (storage, message) => {
      const { tx, saved } = transaction(structuredClone(DEFAULT_CONFIG))
      const failure = await applyConfigUpdate(
        tx,
        change({ general: { storage } })
      ).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(ConfigValidationError)
      expect(failure).toMatchObject({ status: 400, message })
      expect(saved).toEqual([])
    }
  )

  it('judges a partial change with the saved keys, which a blank submission keeps', async () => {
    const { tx, saved } = transaction(withStorage({ s3 }))
    // The route drops blank keys before the change reaches the merge.
    await applyConfigUpdate(
      tx,
      change({
        general: {
          storage: { provider: 's3', s3: { bucket: ' renamed ' } },
        },
      })
    )
    expect((saved[0] as Saved).settings.general.storage).toMatchObject({
      provider: 's3',
      s3: { ...s3, bucket: 'renamed' },
    })
  })

  it('keeps completing an endpoint without a scheme as HTTPS', async () => {
    const { tx, saved } = transaction(withStorage({ s3 }))
    await applyConfigUpdate(
      tx,
      change({
        general: {
          storage: { provider: 's3', s3: { endpoint: 's3.example.test/' } },
        },
      })
    )
    expect((saved[0] as Saved).settings.general.storage.s3.endpoint).toBe(
      'https://s3.example.test'
    )
  })

  it('lets hidden S3 details stay unfinished when local storage is chosen', async () => {
    const { tx, saved } = transaction(
      withStorage({ provider: 's3', s3: { ...s3, accessKeyId: '' } })
    )
    await applyConfigUpdate(
      tx,
      change({ general: { storage: { provider: 'local' } } })
    )
    expect((saved[0] as Saved).settings.general.storage.provider).toBe('local')
  })

  it('saves other settings while incomplete S3 settings saved earlier wait for a storage change', async () => {
    const { tx, saved } = transaction(withStorage({ provider: 's3' }))
    await applyConfigUpdate(
      tx,
      change({ general: { registrations: { enabled: false } } })
    )
    expect(saved).toHaveLength(1)
  })
})
