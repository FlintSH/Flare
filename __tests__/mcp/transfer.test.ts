import type { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashApiToken } from '@/lib/integrations/tokens'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import { ToolError } from '@/lib/mcp/tool'
import {
  DOWNLOAD_MINUTES,
  MAX_OUTSTANDING_TRANSFERS,
  TRANSFER_PATH,
  TransferLimitError,
  UPLOAD_MINUTES,
  claimUpload,
  consumeUpload,
  createDownloadUrl,
  createUploadUrl,
  deleteExpiredTransfers,
  findTransfer,
  releaseUpload,
  uploadOf,
} from '@/lib/mcp/transfer'
import { startTransferCleanupWorker } from '@/lib/mcp/worker'

type Row = {
  id: string
  secretHash: string
  userId: string
  credential: string
  kind: string
  fileId: string | null
  options: unknown
  expiresAt: Date
  claimedAt: Date | null
  createdAt: Date
}
type Where = {
  id?: string
  secretHash?: string
  userId?: string
  credential?: string
  kind?: string
  claimedAt?: null
  expiresAt?: { lte?: Date; gt?: Date }
}

const table = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as string[],
  failing: false,
  warn: vi.fn(),
}))

/** The few queries the transfer module makes, answered from memory. */
const agentTransfer = vi.hoisted(() => {
  const matches = (row: Row, where: Where) =>
    (where.id === undefined || row.id === where.id) &&
    (where.secretHash === undefined || row.secretHash === where.secretHash) &&
    (where.userId === undefined || row.userId === where.userId) &&
    (where.credential === undefined || row.credential === where.credential) &&
    (where.kind === undefined || row.kind === where.kind) &&
    (!('claimedAt' in where) || row.claimedAt === null) &&
    (where.expiresAt?.lte === undefined ||
      row.expiresAt <= where.expiresAt.lte) &&
    (where.expiresAt?.gt === undefined || row.expiresAt > where.expiresAt.gt)
  const query = <T>(name: string, run: () => T) => {
    table.calls.push(name)
    if (table.failing) throw new Error('Database unavailable')
    return run()
  }
  return {
    deleteMany: async ({ where }: { where: Where }) =>
      query('deleteMany', () => {
        const kept = table.rows.filter((row) => !matches(row, where))
        const count = table.rows.length - kept.length
        table.rows = kept
        return { count }
      }),
    count: async ({ where }: { where: Where }) =>
      query(
        'count',
        () => table.rows.filter((row) => matches(row, where)).length
      ),
    create: async ({ data }: { data: Partial<Row> }) =>
      query('create', () => {
        const row = {
          id: `transfer-${table.rows.length + 1}-${Math.random()}`,
          fileId: null,
          options: null,
          claimedAt: null,
          createdAt: new Date(),
          ...data,
        } as Row
        table.rows.push(row)
        return row
      }),
    findUnique: async ({ where }: { where: Where }) =>
      query(
        'findUnique',
        () => table.rows.find((row) => matches(row, where)) ?? null
      ),
    updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) =>
      query('updateMany', () => {
        const found = table.rows.filter((row) => matches(row, where))
        for (const row of found) Object.assign(row, data)
        return { count: found.length }
      }),
  }
})
vi.mock('@/lib/database/prisma', () => {
  // The row lock of an account, as PostgreSQL holds it: whoever asks next
  // waits until the transaction holding it ends.
  const held = new Map<string, Promise<void>>()
  return {
    prisma: {
      agentTransfer,
      // The periodic sweep, answered from memory: expired rows in id order,
      // up to the batch it asks for. Nobody holds a row here, so it passes
      // over none; PostgreSQL answers for that in the database suite.
      $executeRaw: async (
        statement: TemplateStringsArray,
        now: Date,
        batch: number
      ) => {
        // Only transfer URLs are kept here; the sign-in sweep that runs
        // after this one finds no tables of its own, as before.
        if (!statement.join('?').includes('DELETE FROM "AgentTransfer"'))
          throw new Error('No such table here')
        table.calls.push('sweep')
        if (table.failing) throw new Error('Database unavailable')
        const gone = table.rows
          .filter((row) => row.expiresAt <= now)
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, batch)
        table.rows = table.rows.filter((row) => !gone.includes(row))
        return gone.length
      },
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        let release = () => {}
        const tx = {
          agentTransfer,
          $queryRaw: async (_query: unknown, userId: string) => {
            table.calls.push(`lock ${userId}`)
            const before = held.get(userId) ?? Promise.resolve()
            held.set(
              userId,
              new Promise<void>((resolve) => {
                release = resolve
              })
            )
            await before
            return []
          },
        }
        try {
          return await run(tx)
        } finally {
          release()
        }
      },
    },
  }
})
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ warn: table.warn }) }))

const ORIGIN = 'https://flare.test'
const NOW = new Date('2026-11-21T12:00:00.000Z')
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000)

const principal = (
  credentialKey = 'token:token-1',
  userId = 'owner'
): AgentPrincipal => ({ user: { id: userId }, credentialKey }) as AgentPrincipal

const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1)

/** A row put straight in the table, as an earlier call would have left it. */
function seed(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: `seed-${table.rows.length + 1}`,
    secretHash: `hash-${table.rows.length + 1}`,
    userId: 'owner',
    credential: 'token:token-1',
    kind: 'download',
    fileId: 'file-1',
    options: null,
    expiresAt: minutes(5),
    claimedAt: null,
    createdAt: NOW,
    ...overrides,
  }
  table.rows.push(row)
  return row
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  table.rows = []
  table.calls = []
  table.failing = false
  table.warn.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('making a transfer URL', () => {
  it('answers a URL whose secret is stored only as a digest', async () => {
    const { url, expires_at } = await createDownloadUrl(
      principal(),
      ORIGIN,
      'file-9'
    )
    const secret = secretOf(url)
    expect(url).toBe(`${ORIGIN}${TRANSFER_PATH}/${secret}`)
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(table.rows).toHaveLength(1)
    const [row] = table.rows
    expect(row).toMatchObject({
      userId: 'owner',
      credential: 'token:token-1',
      kind: 'download',
      fileId: 'file-9',
      options: null,
      claimedAt: null,
      secretHash: hashApiToken(secret),
    })
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(row.expiresAt).toEqual(minutes(DOWNLOAD_MINUTES))
    expect(expires_at).toBe(minutes(DOWNLOAD_MINUTES).toISOString())
    expect(DOWNLOAD_MINUTES).toBe(10)
  })

  it('gives every URL its own secret', async () => {
    const first = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    const second = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    expect(secretOf(first.url)).not.toBe(secretOf(second.url))
    expect(table.rows).toHaveLength(2)
  })

  it('keeps what an upload URL fixed, for 15 minutes', async () => {
    const upload = {
      filename: 'report.pdf',
      options: { visibility: 'PRIVATE' as const, folderId: 'folder-1' },
      passwordHash: '$2b$10$hash',
    }
    const { url, expires_at } = await createUploadUrl(
      principal(),
      ORIGIN,
      upload
    )
    const [row] = table.rows
    expect(row).toMatchObject({
      kind: 'upload',
      fileId: null,
      options: upload,
      secretHash: hashApiToken(secretOf(url)),
    })
    expect(expires_at).toBe(minutes(UPLOAD_MINUTES).toISOString())
    expect(UPLOAD_MINUTES).toBe(15)
    expect(uploadOf(row as never)).toEqual(upload)
  })

  it('reads a row without options as an upload with none', () => {
    expect(uploadOf({ options: null } as never)).toEqual({ options: {} })
  })

  it('stops at the number of download links one credential may have waiting', async () => {
    expect(MAX_OUTSTANDING_TRANSFERS).toBe(20)
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++) seed()
    const refusal = await createDownloadUrl(principal(), ORIGIN, 'file-9').then(
      () => null,
      (error: unknown) => error
    )
    expect(refusal).toBeInstanceOf(TransferLimitError)
    // A refusal worded for the agent, like every other tool error.
    expect(refusal).toBeInstanceOf(ToolError)
    expect(refusal).toMatchObject({
      name: 'TransferLimitError',
      outcome: 'failure',
      message: `This connection already has ${MAX_OUTSTANDING_TRANSFERS} download links waiting. Wait a few minutes for them to expire.`,
    })
    expect(table.rows).toHaveLength(MAX_OUTSTANDING_TRANSFERS)
    expect(table.calls).not.toContain('create')
  })

  it('stops at the number of upload URLs one credential may have waiting', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      seed({ kind: 'upload', fileId: null })
    await expect(
      createUploadUrl(principal(), ORIGIN, { options: {} })
    ).rejects.toThrow(new TransferLimitError('upload'))
    await expect(
      createUploadUrl(principal(), ORIGIN, { options: {} })
    ).rejects.toThrow(
      `This connection already has ${MAX_OUTSTANDING_TRANSFERS} upload URLs waiting. Use them, or wait: one that was never used expires 15 minutes after it was made, and one whose upload never finished after 24 hours.`
    )
    expect(table.rows).toHaveLength(MAX_OUTSTANDING_TRANSFERS)
    expect(table.calls).not.toContain('create')
  })

  it('counts downloads and uploads apart: reading many files does not block an upload', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++) seed()
    // Twenty download links wait, and every upload URL is still to be had.
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      await createUploadUrl(principal(), ORIGIN, { options: {} })
    expect(table.rows.filter((row) => row.kind === 'upload')).toHaveLength(
      MAX_OUTSTANDING_TRANSFERS
    )
    // Now both kinds are full, each on its own count.
    await expect(
      createUploadUrl(principal(), ORIGIN, { options: {} })
    ).rejects.toThrow(/upload URLs waiting/)
    await expect(
      createDownloadUrl(principal(), ORIGIN, 'file-9')
    ).rejects.toThrow(/download links waiting/)
    expect(table.rows).toHaveLength(2 * MAX_OUTSTANDING_TRANSFERS)
  })

  it('counts downloads and uploads apart: many upload URLs do not block a download', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      seed({ kind: 'upload', fileId: null })
    await expect(
      createUploadUrl(principal(), ORIGIN, { options: {} })
    ).rejects.toThrow(TransferLimitError)
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      await createDownloadUrl(principal(), ORIGIN, `file-${index}`)
    await expect(
      createDownloadUrl(principal(), ORIGIN, 'one-too-many')
    ).rejects.toThrow(TransferLimitError)
    expect(table.rows.filter((row) => row.kind === 'download')).toHaveLength(
      MAX_OUTSTANDING_TRANSFERS
    )
  })

  it('counts each credential and each account on its own', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++) seed()
    // Another token of the same account, and the same token ID elsewhere.
    await createDownloadUrl(principal('token:token-2'), ORIGIN, 'file-9')
    await createDownloadUrl(
      principal('token:token-1', 'someone-else'),
      ORIGIN,
      'file-9'
    )
    expect(table.rows).toHaveLength(MAX_OUTSTANDING_TRANSFERS + 2)
  })

  it('clears the expired URLs of its credential before it counts', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      seed({ expiresAt: index % 2 ? minutes(-1) : NOW })
    const foreign = seed({
      credential: 'token:token-2',
      expiresAt: minutes(-9),
    })
    const live = seed({ expiresAt: minutes(1) })
    await createDownloadUrl(principal(), ORIGIN, 'file-9')
    // Only this credential's expired rows went; the sweep takes the others.
    expect(table.rows).toHaveLength(3)
    expect(table.rows).toContain(foreign)
    expect(table.rows).toContain(live)
    expect(table.calls).toEqual(['lock owner', 'deleteMany', 'count', 'create'])
  })

  it('counts and adds under the lock of its account, so calls arriving together cannot pass the limit', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS - 1; index++) seed()
    const results = await Promise.allSettled([
      createDownloadUrl(principal(), ORIGIN, 'file-9'),
      createDownloadUrl(principal(), ORIGIN, 'file-9'),
      createDownloadUrl(principal(), ORIGIN, 'file-9'),
    ])
    expect(results.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
    ])
    expect(table.rows).toHaveLength(MAX_OUTSTANDING_TRANSFERS)
    expect(table.calls.filter((call) => call === 'lock owner')).toHaveLength(3)
  })

  it('lets an upload URL through beside downloads that arrive together at their limit', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS - 1; index++) seed()
    const results = await Promise.allSettled([
      createDownloadUrl(principal(), ORIGIN, 'file-9'),
      createDownloadUrl(principal(), ORIGIN, 'file-9'),
      createUploadUrl(principal(), ORIGIN, { options: {} }),
    ])
    expect(results.map(({ status }) => status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ])
    expect(table.rows.filter((row) => row.kind === 'download')).toHaveLength(
      MAX_OUTSTANDING_TRANSFERS
    )
    expect(table.rows.filter((row) => row.kind === 'upload')).toHaveLength(1)
  })

  it('makes room again once waiting URLs expire', async () => {
    for (let index = 0; index < MAX_OUTSTANDING_TRANSFERS; index++)
      seed({ expiresAt: minutes(5) })
    await expect(
      createDownloadUrl(principal(), ORIGIN, 'file-9')
    ).rejects.toThrow(ToolError)
    vi.setSystemTime(minutes(5))
    await createDownloadUrl(principal(), ORIGIN, 'file-9')
    expect(table.rows).toHaveLength(1)
  })
})

describe('finding a transfer', () => {
  it('finds an unexpired transfer of the kind asked for', async () => {
    const { url } = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    const found = await findTransfer(secretOf(url), 'download')
    expect(found).toBe(table.rows[0])
  })

  it.each([
    [''],
    ['short'],
    ['a'.repeat(42)],
    ['a'.repeat(44)],
    [`${'a'.repeat(42)}/`],
    [`${'a'.repeat(42)}.`],
    [`${'a'.repeat(42)}%`],
    [`${'a'.repeat(42)} `],
    ['../../../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaa'],
  ])('refuses %j without looking it up', async (secret) => {
    expect(await findTransfer(secret, 'download')).toBeNull()
    expect(await findTransfer(secret, 'upload')).toBeNull()
    expect(table.calls).toEqual([])
  })

  it('finds nothing for a secret nobody was given', async () => {
    await createDownloadUrl(principal(), ORIGIN, 'file-9')
    expect(await findTransfer('b'.repeat(43), 'download')).toBeNull()
    // The digest of a secret is not a secret that opens anything.
    expect(await findTransfer(table.rows[0].secretHash, 'download')).toBeNull()
  })

  it('keeps downloads and uploads apart', async () => {
    const download = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    const upload = await createUploadUrl(principal(), ORIGIN, { options: {} })
    expect(await findTransfer(secretOf(download.url), 'upload')).toBeNull()
    expect(await findTransfer(secretOf(upload.url), 'download')).toBeNull()
    expect(await findTransfer(secretOf(upload.url), 'upload')).not.toBeNull()
  })

  it('stops finding a transfer the moment it expires', async () => {
    const { url } = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    vi.setSystemTime(minutes(DOWNLOAD_MINUTES).getTime() - 1)
    expect(await findTransfer(secretOf(url), 'download')).not.toBeNull()
    vi.setSystemTime(minutes(DOWNLOAD_MINUTES))
    expect(await findTransfer(secretOf(url), 'download')).toBeNull()
  })

  it('finds a download again and again until then', async () => {
    const { url } = await createDownloadUrl(principal(), ORIGIN, 'file-9')
    for (let attempt = 0; attempt < 3; attempt++)
      expect(await findTransfer(secretOf(url), 'download')).not.toBeNull()
    expect(table.rows[0].claimedAt).toBeNull()
  })
})

describe('using an upload URL once', () => {
  it('gives the URL to the first request only', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    expect(await claimUpload(row.id)).toBe(true)
    expect(row.claimedAt).toEqual(NOW)
    expect(await claimUpload(row.id)).toBe(false)
    expect(await claimUpload(row.id)).toBe(false)
  })

  it('gives it to one of two requests that arrive together', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    const claims = await Promise.all([claimUpload(row.id), claimUpload(row.id)])
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('claims with one conditional write, so the database decides', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    await claimUpload(row.id)
    expect(table.calls).toEqual(['updateMany'])
  })

  it('does not give out a URL that expired or does not exist', async () => {
    const row = seed({ kind: 'upload', fileId: null, expiresAt: NOW })
    expect(await claimUpload(row.id)).toBe(false)
    expect(row.claimedAt).toBeNull()
    expect(await claimUpload('missing')).toBe(false)
  })

  it('gives a released URL out again, once', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    await claimUpload(row.id)
    await releaseUpload(row.id)
    expect(row.claimedAt).toBeNull()
    expect(await claimUpload(row.id)).toBe(true)
    expect(await claimUpload(row.id)).toBe(false)
  })

  it('removes the URL through the transaction that publishes its file', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    const other = seed({ kind: 'upload', fileId: null })
    const deleteMany = vi.fn(async () => ({ count: 1 }))
    const tx = { agentTransfer: { deleteMany } }
    await consumeUpload(tx as unknown as Prisma.TransactionClient, row.id)
    expect(deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: row.id },
    })
    // Nothing outside the transaction is touched.
    expect(table.calls).toEqual([])
    expect(table.rows).toEqual([row, other])
  })

  it('passes a failed removal on, so the publishing transaction rolls back', async () => {
    const tx = {
      agentTransfer: {
        deleteMany: vi
          .fn()
          .mockRejectedValue(new Error('Database unavailable')),
      },
    }
    await expect(
      consumeUpload(tx as unknown as Prisma.TransactionClient, 'transfer-1')
    ).rejects.toThrow('Database unavailable')
  })

  it('never fails the request when releasing cannot be written', async () => {
    const row = seed({ kind: 'upload', fileId: null })
    table.failing = true
    await expect(releaseUpload(row.id)).resolves.toBeUndefined()
  })
})

describe('sweeping expired transfers', () => {
  it('removes every expired URL and counts them', async () => {
    const live = seed({ expiresAt: minutes(1) })
    seed({ expiresAt: NOW })
    seed({ expiresAt: minutes(-30), credential: 'token:token-2' })
    seed({
      expiresAt: minutes(-1),
      kind: 'upload',
      claimedAt: minutes(-2),
      userId: 'someone-else',
    })
    expect(await deleteExpiredTransfers()).toBe(3)
    expect(table.rows).toEqual([live])
    expect(await deleteExpiredTransfers()).toBe(0)
  })

  it('measures against the time it is given', async () => {
    seed({ expiresAt: minutes(5) })
    expect(await deleteExpiredTransfers(minutes(4))).toBe(0)
    expect(await deleteExpiredTransfers(minutes(5))).toBe(1)
  })
})

describe('the cleanup worker', () => {
  let worker: ReturnType<typeof startTransferCleanupWorker> | undefined
  afterEach(() => {
    worker?.stop()
    worker = undefined
  })

  it('sweeps every 15 minutes, as one worker however often it is started', async () => {
    const live = seed({ expiresAt: minutes(60) })
    seed({ expiresAt: minutes(-1) })
    const soon = seed({ expiresAt: minutes(20) })
    worker = startTransferCleanupWorker()
    expect(startTransferCleanupWorker()).toBe(worker)
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1)
    expect(table.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(table.calls).toEqual(['sweep'])
    expect(table.rows).toEqual([live, soon])
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    // One sweep per interval: starting it twice did not double it.
    expect(table.calls).toEqual(['sweep', 'sweep'])
    expect(table.rows).toEqual([live])
  })

  it('tries again after a failed sweep, without logging what failed', async () => {
    seed({ expiresAt: minutes(-1) })
    table.failing = true
    worker = startTransferCleanupWorker()
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(table.warn.mock.calls).toEqual([
      ['Transfer URL cleanup unavailable; retrying on the next run.'],
    ])
    expect(table.rows).toHaveLength(1)
    table.failing = false
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(table.rows).toEqual([])
  })

  it('stops when told to', async () => {
    seed({ expiresAt: minutes(-1) })
    worker = startTransferCleanupWorker()
    worker.stop()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(table.calls).toEqual([])
  })
})
