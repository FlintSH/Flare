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
