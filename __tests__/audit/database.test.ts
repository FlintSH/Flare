import { type Prisma, PrismaClient } from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { auditContext } from '@/lib/audit/context'
import { withPrismaAudit } from '@/lib/audit/prisma'

const databaseUrl = process.env.FLARE_AUDIT_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite.sequential('audit against disposable PostgreSQL', () => {
  let base: PrismaClient
  let prisma: PrismaClient
  beforeAll(() => {
    const url = new URL(databaseUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/flare_audit_test' ||
      [...url.searchParams.keys()].some(
        (key) => !['schema', 'connection_limit'].includes(key)
      ) ||
      (url.searchParams.has('schema') &&
        url.searchParams.get('schema') !== 'public')
    )
      throw new Error('Use the disposable local flare_audit_test database')
    base = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    prisma = withPrismaAudit(base)
  })
  beforeEach(async () => {
    await base.user.deleteMany()
    await base.role.deleteMany()
    await base.config.deleteMany()
    await base.auditEvent.deleteMany()
    await base.user.create({
      data: {
        id: 'audit-actor',
        name: 'Alex',
        urlId: 'audit-actor',
        uploadToken: 'fixture-secret',
      },
    })
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await base?.$disconnect()
  })

  it('uses the transaction connection, captures uncommitted role assignments, and persists only after commit', async () => {
    await auditContext.run(
      { actorId: 'audit-actor', actorName: 'Alex', requestId: 'request-roles' },
      () =>
        prisma.$transaction(async (tx) => {
          const role = await tx.role.create({
            data: {
              id: 'role-audit',
              name: 'Reviewer',
              permissions: ['audit.read'],
            },
          })
          await tx.user.update({
            where: { id: 'audit-actor' },
            data: { roles: { set: [{ id: role.id }] } },
            select: { id: true },
          })
          expect(await tx.auditEvent.count()).toBe(0)
        })
    )
    const event = await base.auditEvent.findFirstOrThrow({
      where: { action: 'user.update' },
    })
    expect(event).toMatchObject({
      actorId: 'audit-actor',
      actorName: 'Alex',
      targetName: 'Alex',
      requestId: 'request-roles',
    })
    expect(event.details).toMatchObject({
      before: { roleIds: [] },
      after: { roleIds: ['role-audit'] },
      changedFields: ['roles'],
    })
  })

  it('drops successful mutations that rolled back and retains explicit mutation failures', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.role.create({ data: { name: 'Rolled back', permissions: [] } })
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    expect(await base.auditEvent.count()).toBe(0)
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: 'missing' },
          data: { name: 'Missing' },
        })
      })
    ).rejects.toThrow()
    expect(
      await base.auditEvent.count({
        where: { outcome: 'failure', action: 'user.update' },
      })
    ).toBe(1)
  })

  it('retains every bulk filename and exact before/after visibility including batches larger than 1000', async () => {
    await base.file.createMany({
      data: Array.from({ length: 1005 }, (_, index) => ({
        id: `file-${index}`,
        name: `invoice-${index}.pdf`,
        userId: 'audit-actor',
        urlPath: `file-${index}`,
        path: `fixture/file-${index}`,
        mimeType: 'application/pdf',
        size: 12,
      })),
    })
    const auditBatches = vi.spyOn(base.auditEvent, 'createMany')
    const auditSingles = vi.spyOn(base.auditEvent, 'create')
    await prisma.$transaction(
      async (tx) => {
        await tx.file.updateMany({
          where: { userId: 'audit-actor', visibility: 'PUBLIC' },
          data: { visibility: 'PRIVATE' },
        })
      },
      { timeout: 30000 }
    )
    expect(
      auditBatches.mock.calls.map(([args]) => (args!.data as unknown[]).length)
    ).toEqual([500, 500, 5])
    expect(auditSingles).not.toHaveBeenCalled()
    auditBatches.mockClear()
    expect(
      await base.auditEvent.count({ where: { action: 'file.updateMany' } })
    ).toBe(1005)
    const updated = await base.auditEvent.findFirstOrThrow({
      where: { action: 'file.updateMany', targetId: 'file-1004' },
    })
    expect(updated).toMatchObject({
      targetName: 'invoice-1004.pdf',
      details: {
        before: { visibility: 'PUBLIC' },
        after: { visibility: 'PRIVATE' },
      },
    })
    await prisma.file.deleteMany({ where: { userId: 'audit-actor' } })
    expect(
      auditBatches.mock.calls.map(([args]) => (args!.data as unknown[]).length)
    ).toEqual([500, 500, 5])
    expect(auditSingles).not.toHaveBeenCalled()
    expect(
      await base.auditEvent.count({ where: { action: 'file.deleteMany' } })
    ).toBe(1005)
    expect(
      await base.auditEvent.findFirstOrThrow({
        where: { action: 'file.deleteMany', targetId: 'file-1004' },
      })
    ).toMatchObject({ targetName: 'invoice-1004.pdf' })
  }, 30000)

  async function fixtureFile(
    id: string,
    visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC'
  ) {
    return base.file.create({
      data: {
        id,
        name: `${id}.pdf`,
        userId: 'audit-actor',
        urlPath: id,
        path: `fixture/${id}`,
        mimeType: 'application/pdf',
        size: 12,
        visibility,
      },
    })
  }

  it('uses the actual mutation result when another writer changes visibility immediately afterwards, including partial projections', async () => {
    await fixtureFile('interleaved')
    const raced = prisma.$extends({
      query: {
        file: {
          async update({ args, query }) {
            const result = await query(args)
            await base.file.update({
              where: { id: 'interleaved' },
              data: { visibility: 'PRIVATE' },
            })
            return result
          },
        },
      },
    })
    const result = await raced.file.update({
      where: { id: 'interleaved' },
      data: { name: 'renamed.pdf' },
      select: { id: true },
    })
    expect(result).toEqual({ id: 'interleaved' })
    const event = await base.auditEvent.findFirstOrThrow({
      where: { action: 'file.update' },
    })
    expect(event).toMatchObject({
      targetName: 'renamed.pdf',
      details: {
        changedFields: ['name'],
        beforeObserved: true,
        before: { name: 'interleaved.pdf', visibility: 'PUBLIC' },
        after: { name: 'renamed.pdf', visibility: 'PUBLIC' },
      },
    })
    expect(
      (await base.file.findUniqueOrThrow({ where: { id: 'interleaved' } }))
        .visibility
    ).toBe('PRIVATE')
  })

  it('labels preliminary context when another writer changes the row before our update and preserves atomic increments', async () => {
    await fixtureFile('before-race')
    const findUnique = base.file.findUnique.bind(base.file)
    vi.spyOn(base.file, 'findUnique').mockImplementationOnce((async (
      args: Prisma.FileFindUniqueArgs
    ) => {
      const observed = await findUnique(args)
      await base.file.update({
        where: { id: 'before-race' },
        data: { visibility: 'PRIVATE', views: 10 },
      })
      return observed
    }) as unknown as typeof base.file.findUnique)
    await prisma.file.update({
      where: { id: 'before-race' },
      data: { name: 'owner.pdf', views: { increment: 1 } },
      select: { name: true },
    })
    const event = await base.auditEvent.findFirstOrThrow({
      where: { action: 'file.update' },
    })
    expect(event.details).toMatchObject({
      changedFields: ['name', 'views'],
      beforeObserved: true,
      before: { visibility: 'PUBLIC', views: 0 },
      after: { name: 'owner.pdf', visibility: 'PRIVATE', views: 11 },
    })
  })

  it('returns the exact caller projection for nested select, include, omit, and default scalar results', async () => {
    const role = await base.role.create({
      data: { name: 'Reviewer', permissions: [] },
    })
    const selected = await prisma.user.update({
      where: { id: 'audit-actor' },
      data: { roles: { set: [{ id: role.id }] } },
      select: { roles: { select: { name: true } } },
    })
    expect(selected).toEqual({ roles: [{ name: 'Reviewer' }] })
    const included = await prisma.user.update({
      where: { id: 'audit-actor' },
      data: { name: 'Alex included' },
      include: { roles: { select: { name: true } } },
    })
    expect(included).toEqual(
      await base.user.findUniqueOrThrow({
        where: { id: 'audit-actor' },
        include: { roles: { select: { name: true } } },
      })
    )
    const omitted = await prisma.user.update({
      where: { id: 'audit-actor' },
      data: { name: 'Alex omitted' },
      omit: { name: true },
    })
    expect(omitted).toEqual(
      await base.user.findUniqueOrThrow({
        where: { id: 'audit-actor' },
        omit: { name: true },
      })
    )
    expect(omitted).not.toHaveProperty('roles')
    const scalars = await prisma.user.update({
      where: { id: 'audit-actor' },
      data: { name: 'Alex final' },
    })
    expect(scalars).toEqual(
      await base.user.findUniqueOrThrow({ where: { id: 'audit-actor' } })
    )
    expect(scalars).not.toHaveProperty('roles')
    const events = await base.auditEvent.findMany({
      where: { action: 'user.update' },
    })
    expect(events).toHaveLength(4)
    for (const event of events)
      expect(event.details).toMatchObject({ after: { roleIds: [role.id] } })
    expect(
      events.find((event) => event.targetName === 'Alex omitted')?.details
    ).toMatchObject({ after: { name: 'Alex omitted' } })
    const filtered = await prisma.user.update({
      where: { id: 'audit-actor' },
      data: { name: 'Alex filtered' },
      select: {
        roles: { where: { name: 'Missing' }, take: 1, select: { name: true } },
      },
    })
    expect(filtered).toEqual({ roles: [] })
    const filteredEvent = await base.auditEvent.findFirstOrThrow({
      where: { targetName: 'Alex filtered' },
    })
    expect(
      (filteredEvent.details as { after: object }).after
    ).not.toHaveProperty('roleIds')
  })

  it('identifies the rows a bulk mutation actually changed when its membership races, without observing a later writer', async () => {
    await fixtureFile('left')
    await fixtureFile('joined', 'PRIVATE')
    const findMany = base.file.findMany.bind(base.file)
    vi.spyOn(base.file, 'findMany').mockImplementationOnce((async (
      args?: Prisma.FileFindManyArgs
    ) => {
      const observed = await findMany(args)
      await base.file.update({
        where: { id: 'left' },
        data: { visibility: 'PRIVATE' },
      })
      await base.file.update({
        where: { id: 'joined' },
        data: { visibility: 'PUBLIC', views: 10 },
      })
      return observed
    }) as unknown as typeof base.file.findMany)
    const updateReturning = base.file.updateManyAndReturn.bind(base.file)
    vi.spyOn(base.file, 'updateManyAndReturn').mockImplementationOnce((async (
      args: Prisma.FileUpdateManyAndReturnArgs
    ) => {
      const actual = await updateReturning(args)
      await base.file.update({
        where: { id: 'joined' },
        data: { name: 'later.pdf', views: 100 },
      })
      return actual
    }) as unknown as typeof base.file.updateManyAndReturn)
    expect(
      await prisma.file.updateMany({
        where: { visibility: 'PUBLIC' },
        data: { views: { increment: 1 } },
      })
    ).toEqual({ count: 1 })
    const events = await base.auditEvent.findMany({
      where: { action: 'file.updateMany' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: 'joined',
      targetName: 'joined.pdf',
      details: {
        changedFields: ['views'],
        before: {},
        after: { name: 'joined.pdf', views: 11 },
        count: 1,
      },
    })
  })

  it('locks and rechecks bulk deletions so concurrent predicate changes cannot blame the wrong filename', async () => {
    await fixtureFile('no-longer-matches')
    await fixtureFile('deleted')
    const findMany = base.file.findMany.bind(base.file)
    vi.spyOn(base.file, 'findMany').mockImplementationOnce((async (
      args?: Prisma.FileFindManyArgs
    ) => {
      const candidates = await findMany(args)
      await base.file.update({
        where: { id: 'no-longer-matches' },
        data: { visibility: 'PRIVATE' },
      })
      await base.file.update({
        where: { id: 'deleted' },
        data: { name: 'final-name.pdf' },
      })
      await fixtureFile('new-arrival')
      return candidates
    }) as unknown as typeof base.file.findMany)
    expect(
      await prisma.file.deleteMany({ where: { visibility: 'PUBLIC' } })
    ).toEqual({ count: 1 })
    expect(
      await base.file.findMany({ orderBy: { id: 'asc' }, select: { id: true } })
    ).toEqual([{ id: 'new-arrival' }, { id: 'no-longer-matches' }])
    const events = await base.auditEvent.findMany({
      where: { action: 'file.deleteMany' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: 'deleted',
      targetName: 'final-name.pdf',
      details: {
        count: 1,
        before: { name: 'final-name.pdf', visibility: 'PUBLIC' },
      },
    })
    expect(events[0].details).not.toHaveProperty('beforeObserved')
  })

  it('deletes selected parent and child folders in one statement across lock chunks', async () => {
    await base.vaultFolder.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: `folder-${String(index).padStart(4, '0')}`,
        name: `Folder ${index}`,
        normalizedName: `folder-${index}`,
        userId: 'audit-actor',
        parentId: index === 500 ? 'folder-0000' : null,
      })),
    })
    expect(
      await prisma.vaultFolder.deleteMany({ where: { userId: 'audit-actor' } })
    ).toEqual({ count: 501 })
    expect(await base.vaultFolder.count()).toBe(0)
    expect(
      await base.auditEvent.count({ where: { action: 'folder.deleteMany' } })
    ).toBe(501)
    expect(
      await base.auditEvent.findFirstOrThrow({
        where: { action: 'folder.deleteMany', targetId: 'folder-0500' },
      })
    ).toMatchObject({
      targetName: 'Folder 500',
      details: { before: { parentId: 'folder-0000' } },
    })
  })

  it('performs the original bulk deletion with aggregate evidence if its optional snapshot lookup fails', async () => {
    await fixtureFile('lookup-failed-first')
    await fixtureFile('lookup-failed-second')
    vi.spyOn(base.file, 'findMany').mockRejectedValueOnce(
      new Error('snapshot unavailable')
    )
    expect(
      await prisma.file.deleteMany({ where: { visibility: 'PUBLIC' } })
    ).toEqual({ count: 2 })
    expect(await base.file.count()).toBe(0)
    const events = await base.auditEvent.findMany({
      where: { action: 'file.deleteMany' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: null,
      targetName: null,
      details: { count: 2, before: {} },
    })
  })

  it('honors a global deletion limit, reuses the callback connection, and handles compound tag identities', async () => {
    const first = await fixtureFile('delete-limited-first')
    const second = await fixtureFile('delete-limited-second')
    const tag = await base.vaultTag.create({
      data: {
        name: 'Receipts',
        normalizedName: 'receipts',
        userId: 'audit-actor',
      },
    })
    await base.vaultFileTag.createMany({
      data: [first, second].map((file) => ({ fileId: file.id, tagId: tag.id })),
    })
    await prisma.$transaction(async (tx) => {
      expect(
        await tx.vaultFileTag.deleteMany({ where: { tagId: tag.id }, limit: 1 })
      ).toEqual({ count: 1 })
      expect(await tx.auditEvent.count()).toBe(0)
    })
    expect(await base.vaultFileTag.count()).toBe(1)
    const events = await base.auditEvent.findMany({
      where: { action: 'file_tag.deleteMany' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toMatch(/^delete-limited-(first|second)\.pdf$/)
    expect(events[0].details).toMatchObject({
      count: 1,
      before: { tagId: tag.id },
      tagName: 'Receipts',
    })
    for (const limit of [-1, Number.NaN]) {
      await expect(prisma.file.deleteMany({ limit })).rejects.toThrow()
    }
    await expect(
      prisma.file.deleteMany({
        unknown: true,
      } as unknown as Prisma.FileDeleteManyArgs)
    ).rejects.toThrow()
    expect(await prisma.file.deleteMany({ limit: 0.5 })).toEqual({ count: 0 })
    expect(await base.file.count()).toBe(2)
  })

  it('records exactly the new rows from standalone bulk creation and preserves RETURNING projections', async () => {
    await fixtureFile('existing')
    const data = ['existing', 'inserted'].map((id) => ({
      id,
      name: `${id}.pdf`,
      userId: 'audit-actor',
      urlPath: id,
      path: `fixture/${id}`,
      mimeType: 'application/pdf',
      size: 12,
    }))
    expect(
      await prisma.file.createMany({ data, skipDuplicates: true })
    ).toEqual({ count: 1 })
    expect(
      await base.auditEvent.findMany({
        where: { action: 'file.createMany' },
        select: { targetId: true, targetName: true },
      })
    ).toEqual([{ targetId: 'inserted', targetName: 'inserted.pdf' }])
    expect(
      await prisma.file.updateManyAndReturn({
        where: { id: 'inserted' },
        data: { name: 'returning.pdf' },
        select: { id: true },
      })
    ).toEqual([{ id: 'inserted' }])
    const event = await base.auditEvent.findFirstOrThrow({
      where: { action: 'file.updateManyAndReturn' },
    })
    expect(event).toMatchObject({
      targetName: 'returning.pdf',
      details: { after: { name: 'returning.pdf' } },
    })
  })

  it('keeps count-only bulk writes inside array transactions and drops their rolled-back successes', async () => {
    await fixtureFile('array-transaction')
    await expect(
      prisma.$transaction([
        prisma.file.updateMany({
          where: { id: 'array-transaction' },
          data: { visibility: 'PRIVATE' },
        }),
        prisma.file.update({
          where: { id: 'missing' },
          data: { name: 'missing.pdf' },
        }),
      ])
    ).rejects.toThrow()
    expect(
      (
        await base.file.findUniqueOrThrow({
          where: { id: 'array-transaction' },
        })
      ).visibility
    ).toBe('PUBLIC')
    expect(await base.auditEvent.count({ where: { outcome: 'success' } })).toBe(
      0
    )
    await prisma.$transaction([
      prisma.file.updateMany({
        where: { id: 'array-transaction' },
        data: { visibility: 'PRIVATE' },
      }),
    ])
    const events = await base.auditEvent.findMany({
      where: { action: 'file.updateMany', outcome: 'success' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: 'array-transaction',
      details: { count: 1, before: {}, after: {} },
    })
  })

  it('records settings paths and password changes without storing values or secrets', async () => {
    await base.config.create({
      data: {
        key: 'flare_config',
        value: {
          settings: {
            email: { password: 'old-secret' },
            general: { name: 'Original' },
          },
        },
      },
    })
    await prisma.$transaction(async (tx) => {
      await tx.config.update({
        where: { key: 'flare_config' },
        data: {
          value: {
            settings: {
              email: { password: 'new-secret' },
              general: { name: 'Original' },
            },
          },
        },
      })
      await tx.user.update({
        where: { id: 'audit-actor' },
        data: { password: 'password-secret', uploadToken: 'token-secret' },
      })
    })
    const events = await base.auditEvent.findMany()
    expect(JSON.stringify(events)).not.toMatch(
      /old-secret|new-secret|password-secret|token-secret|fixture-secret/
    )
    expect(
      events.find((event) => event.action === 'setting.update')?.details
    ).toMatchObject({ settingsKeys: ['settings.email.password'] })
    expect(
      events.find((event) => event.action === 'user.update')?.details
    ).toMatchObject({ changedFields: ['password', 'uploadToken'] })
  })

  it('retains filenames on tag changes and failure outcomes for failed email delivery', async () => {
    const file = await base.file.create({
      data: {
        name: 'receipt.pdf',
        userId: 'audit-actor',
        urlPath: 'receipt',
        path: 'fixture/receipt',
        mimeType: 'application/pdf',
        size: 12,
      },
    })
    const tag = await base.vaultTag.create({
      data: {
        name: 'Receipts',
        normalizedName: 'receipts',
        userId: 'audit-actor',
      },
    })
    await prisma.vaultFileTag.create({
      data: { fileId: file.id, tagId: tag.id },
    })
    const mail = await base.mailOutbox.create({
      data: {
        purpose: 'verify',
        recipient: 'private@example.test',
        payload: 'private-link',
        status: 'pending',
      },
    })
    await prisma.mailOutbox.update({
      where: { id: mail.id },
      data: { status: 'failed', lastError: 'secret SMTP details' },
    })
    const events = await base.auditEvent.findMany()
    expect(
      events.find((event) => event.action === 'file_tag.create')
    ).toMatchObject({ targetName: 'receipt.pdf', targetId: file.id })
    expect(
      events.find((event) => event.action === 'mail.update')?.outcome
    ).toBe('failure')
    expect(JSON.stringify(events)).not.toMatch(
      /private@example|private-link|secret SMTP/
    )
  })

  it('records batch tag filenames and tag names without reporting skipped duplicates as new assignments', async () => {
    const first = await base.file.create({
      data: {
        name: 'first.pdf',
        userId: 'audit-actor',
        urlPath: 'first',
        path: 'fixture/first',
        mimeType: 'application/pdf',
        size: 12,
      },
    })
    const second = await base.file.create({
      data: {
        name: 'second.pdf',
        userId: 'audit-actor',
        urlPath: 'second',
        path: 'fixture/second',
        mimeType: 'application/pdf',
        size: 12,
      },
    })
    const tag = await base.vaultTag.create({
      data: {
        name: 'Receipts',
        normalizedName: 'receipts',
        userId: 'audit-actor',
      },
    })
    await base.vaultFileTag.create({
      data: { fileId: first.id, tagId: tag.id },
    })
    await prisma.$transaction(async (tx) => {
      await tx.vaultFileTag.createMany({
        data: [
          { fileId: first.id, tagId: tag.id },
          { fileId: second.id, tagId: tag.id },
        ],
        skipDuplicates: true,
      })
    })
    const events = await base.auditEvent.findMany({
      where: { action: 'file_tag.createMany' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: second.id,
      targetName: 'second.pdf',
      details: {
        tagName: 'Receipts',
        before: {},
        after: { fileId: second.id, tagId: tag.id, excluded: false },
      },
    })
  })

  it.each(['mail', 'webhook'] as const)(
    'records deliberate %s cancellation as success while retaining the cancelled status',
    async (kind) => {
      let id: string
      if (kind === 'mail') {
        const item = await base.mailOutbox.create({
          data: {
            purpose: 'verify',
            recipient: 'fixture@example.test',
            payload: 'private-message',
            status: 'pending',
          },
        })
        id = item.id
        await prisma.mailOutbox.update({
          where: { id },
          data: {
            status: 'cancelled',
            lastError: 'Email delivery was disabled.',
          },
        })
      } else {
        const webhook = await base.webhook.create({
          data: {
            userId: 'audit-actor',
            name: 'Fixture webhook',
            url: 'https://example.test',
            secret: 'fixture-secret',
          },
        })
        const item = await base.webhookDelivery.create({
          data: {
            webhookId: webhook.id,
            eventId: 'fixture-event',
            payload: {},
          },
        })
        id = item.id
        await prisma.webhookDelivery.update({
          where: { id },
          data: {
            status: 'cancelled',
            lastError: 'Webhook disabled by administrator.',
          },
        })
      }
      const audit = await base.auditEvent.findFirstOrThrow({
        where: { targetId: id },
      })
      expect(audit).toMatchObject({
        outcome: 'success',
        details: {
          before: { status: 'pending' },
          after: { status: 'cancelled' },
        },
      })
      expect(JSON.stringify(audit)).not.toMatch(
        /private-message|fixture-secret|fixture@example/
      )
    }
  )

  it('skips zero-row worker polling and audit reads/writes do not recursively audit themselves', async () => {
    await prisma.mailOutbox.updateMany({
      where: { id: 'missing' },
      data: { status: 'pending' },
    })
    expect(
      await prisma.file.updateManyAndReturn({
        where: { id: 'missing' },
        data: { name: 'no-op' },
      })
    ).toEqual([])
    await prisma.auditEvent.create({
      data: { action: 'fixture', category: 'system', outcome: 'success' },
    })
    await prisma.auditEvent.findMany()
    expect(await base.auditEvent.count()).toBe(1)
  })
})
