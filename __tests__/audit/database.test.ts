import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
      await base.auditEvent.count({ where: { action: 'file.deleteMany' } })
    ).toBe(1005)
    expect(
      await base.auditEvent.findFirstOrThrow({
        where: { action: 'file.deleteMany', targetId: 'file-1004' },
      })
    ).toMatchObject({ targetName: 'invoice-1004.pdf' })
  }, 30000)

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
    await prisma.auditEvent.create({
      data: { action: 'fixture', category: 'system', outcome: 'success' },
    })
    await prisma.auditEvent.findMany()
    expect(await base.auditEvent.count()).toBe(1)
  })
})
