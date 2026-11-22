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

/**
 * A transaction whose saved settings are `value`; it records what is saved.
 * It holds one connection within its 30 days (`connection-1`) and, when
 * `ended` names one, a connection past them.
 */
function transaction(value: unknown, ended: string[] = []) {
  const saved: unknown[] = []
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async () => []),
    agentConnection: {
      // Live ones past their grant, then the ones within it.
      findMany: vi.fn(async ({ where }: { where: { revokedAt?: null } }) =>
        'revokedAt' in where
          ? ended.map((id) => ({ id }))
          : [{ id: 'connection-1' }]
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    agentToken: { deleteMany: vi.fn(async () => ({ count: 1 })) },
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

describe('saving custom CSS', () => {
  const css = '\n\nbody {}\n\n\n\na {}\n'

  it('trims it and keeps at most one blank line in a row, whichever route saves it', async () => {
    const { tx, saved } = transaction(structuredClone(DEFAULT_CONFIG))
    await applyConfigUpdate(tx, change({ advanced: { customCSS: css } }))
    expect(
      (saved[0] as typeof DEFAULT_CONFIG).settings.advanced.customCSS
    ).toBe('body {}\n\na {}')
  })

  it('leaves saved custom CSS as it is when a save does not change it', async () => {
    const current = structuredClone(DEFAULT_CONFIG)
    current.settings.advanced.customCSS = css
    const { tx, saved } = transaction(current)
    await applyConfigUpdate(
      tx,
      change({ general: { registrations: { enabled: false } } })
    )
    expect(
      (saved[0] as typeof DEFAULT_CONFIG).settings.advanced.customCSS
    ).toBe(css)
  })
})

describe('administration through MCP', () => {
  /** The tables a save took administration scopes away in, in order. */
  const stripped = (tx: Prisma.TransactionClient) =>
    vi
      .mocked(tx.$executeRaw)
      .mock.calls.map(([strings]) =>
        (strings as TemplateStringsArray).join('?')
      )
      .filter((sql) => sql.includes('UPDATE'))
      .map((sql) => /UPDATE "(\w+)"/.exec(sql)?.[1])
  const saved = (administration: boolean | undefined) => {
    const value = structuredClone(DEFAULT_CONFIG) as {
      settings: { general: { mcp: { administration?: boolean } } }
    }
    if (administration === undefined)
      delete value.settings.general.mcp.administration
    else value.settings.general.mcp.administration = administration
    return value
  }

  it('is off by default, and for settings saved before it existed', async () => {
    expect(DEFAULT_CONFIG.settings.general.mcp.administration).toBe(false)
    const { tx, saved: written } = transaction(saved(undefined))
    await applyConfigUpdate(tx, change({ general: { ocr: { enabled: true } } }))
    expect((written[0] as typeof DEFAULT_CONFIG).settings.general.mcp).toEqual({
      enabled: false,
      administration: false,
    })
    // Nothing was on, so nothing is taken away.
    expect(stripped(tx)).toEqual([])
  })

  it('takes the administration scopes from every credential when it is turned off, in the same transaction', async () => {
    const { tx, saved: written } = transaction(saved(true))
    vi.mocked(tx.$executeRaw).mockResolvedValue(0)
    await applyConfigUpdate(
      tx,
      change({ general: { mcp: { administration: false } } })
    )
    expect(written).toHaveLength(1)
    expect(stripped(tx)).toEqual([
      'ApiToken',
      'AgentConnection',
      'AgentToken',
      'OAuthCode',
    ])
  })

  it('ends a connection past its 30 days instead of stripping it, so it never comes back', async () => {
    const { tx } = transaction(saved(true), ['connection-old'])
    vi.mocked(tx.$executeRaw).mockResolvedValue(0)
    await applyConfigUpdate(
      tx,
      change({ general: { mcp: { administration: false } } })
    )
    // Ended as a disconnect ends one: its row, then revoked, then its pairs.
    expect(tx.agentConnection.updateMany).toHaveBeenCalledWith({
      where: { id: 'connection-old', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'expired' },
    })
    expect(tx.agentToken.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: 'connection-old' },
    })
    // Only the one within its 30 days loses the scopes.
    const update = vi
      .mocked(tx.$executeRaw)
      .mock.calls.find(([strings]) =>
        (strings as TemplateStringsArray)
          .join('?')
          .includes('UPDATE "AgentConnection"')
      )!
    expect(update.slice(1)).toContainEqual(['connection-1'])
    expect(update.slice(1)).not.toContainEqual(['connection-old'])
    // The two lists are read with the same rule at the same moment.
    const [[endedQuery], [withinQuery]] = vi.mocked(tx.agentConnection.findMany)
      .mock.calls as unknown as [{ where: Record<string, unknown> }][]
    expect(withinQuery.where.NOT).toEqual({
      scopes: endedQuery.where.scopes,
      createdAt: endedQuery.where.createdAt,
    })
  })

  it('takes them away whatever else turns it off: a whole document as the legacy form posts it', async () => {
    const { tx } = transaction(saved(true))
    vi.mocked(tx.$executeRaw).mockResolvedValue(0)
    // The legacy POST /api/settings merges a whole settings document.
    const document = structuredClone(DEFAULT_CONFIG)
    await applyConfigUpdate(
      tx,
      document as Parameters<typeof applyConfigUpdate>[1]
    )
    expect(stripped(tx)).toHaveLength(4)
  })

  it('takes them away when it is turned on, too: nothing could rightly hold one while it was off', async () => {
    for (const before of [false, undefined]) {
      const { tx } = transaction(saved(before))
      vi.mocked(tx.$executeRaw).mockResolvedValue(0)
      await applyConfigUpdate(
        tx,
        change({ general: { mcp: { administration: true } } })
      )
      expect(stripped(tx), `${before} to on`).toEqual([
        'ApiToken',
        'AgentConnection',
        'AgentToken',
        'OAuthCode',
      ])
    }
  })

  it('takes nothing away while it stays on or stays off', async () => {
    for (const [before, after] of [
      [true, true],
      [false, false],
      [undefined, false],
    ] as const) {
      const { tx } = transaction(saved(before))
      await applyConfigUpdate(
        tx,
        change({ general: { mcp: { administration: after } } })
      )
      expect(stripped(tx), `${before} to ${after}`).toEqual([])
    }
    // A save of something else leaves it on and takes nothing.
    const { tx } = transaction(saved(true))
    await applyConfigUpdate(
      tx,
      change({ general: { ocr: { enabled: false } } })
    )
    expect(stripped(tx)).toEqual([])
  })

  it('takes nothing away when the save is refused', async () => {
    const { tx, saved: written } = transaction(saved(true))
    await expect(
      applyConfigUpdate(
        tx,
        change({ general: { mcp: { administration: 'off' } } })
      )
    ).rejects.toBeInstanceOf(ConfigValidationError)
    expect(written).toEqual([])
    expect(stripped(tx)).toEqual([])
  })
})
