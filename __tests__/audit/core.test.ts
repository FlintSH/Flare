import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configureAuditWriter,
  recordAudit,
  setAuditActor,
  setAuditOutcome,
  setAuditTarget,
  withAuditRoute,
} from '@/lib/audit'
import { auditQuerySchema, auditWhere } from '@/lib/audit/query'
import { sanitizeAuditDetails } from '@/lib/audit/sanitize'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'

const events: Record<string, unknown>[] = []
beforeEach(() => {
  events.length = 0
  configureAuditWriter(async (event) => {
    events.push(event)
  })
})

describe('safe durable audit events', () => {
  it('retains the filename for failed uploads before a file ID exists', async () => {
    await withAuditRoute(async () => {
      setAuditTarget({ type: 'file', name: 'quarterly-report.pdf' })
      return new Response('Storage unavailable', { status: 503 })
    })(new Request('http://localhost/api/files', { method: 'POST' }))
    expect(events[0]).toMatchObject({
      targetType: 'file',
      targetName: 'quarterly-report.pdf',
      outcome: 'failure',
    })
    expect(events[0].targetId).toBeUndefined()
  })
  it('records private-file denials as denied while preserving the masked 404 response', async () => {
    const response = await withAuditRoute(async () => {
      setAuditOutcome('denied')
      return new Response('Not found', { status: 404 })
    })(new Request('http://localhost/api/files/hidden'))
    expect(response.status).toBe(404)
    expect(events[0]).toMatchObject({ outcome: 'denied', status: 404 })
  })

  it('can keep successful audit reads quiet without suppressing denied attempts', async () => {
    await withAuditRoute(async () => new Response(null), { skipSuccess: true })(
      new Request('http://localhost/api/audit')
    )
    expect(events).toHaveLength(0)
    await withAuditRoute(async () => new Response(null, { status: 403 }), {
      skipSuccess: true,
    })(new Request('http://localhost/api/audit'))
    expect(events[0]).toMatchObject({ outcome: 'denied' })
  })
  it('allowlists metadata recursively and excludes payloads, credentials, content and raw errors', async () => {
    await recordAudit({
      action: 'file.update',
      category: 'files',
      targetName: 'invoice.pdf',
      details: {
        before: {
          name: 'old.pdf',
          password: 'secret',
          ocrText: 'private text',
          value: { smtp: 'secret' },
        },
        after: { name: 'invoice.pdf', visibility: 'PRIVATE' },
        body: { password: 'secret' },
        headers: { authorization: 'secret' },
        error: 'secret database URL',
        changedFields: ['password', 'visibility', 'invalid;secret'],
        authMethod: 'passkey',
        includesCurrent: false,
      },
    })
    expect(events[0].details).toEqual({
      before: { name: 'old.pdf' },
      after: { name: 'invoice.pdf', visibility: 'PRIVATE' },
      changedFields: ['password', 'visibility'],
      authMethod: 'passkey',
      includesCurrent: false,
    })
    expect(JSON.stringify(events)).not.toContain('secret')
    expect(events[0].actorName).toBe('System')
  })

  it('bounds strings, arrays and nesting, and removes non-finite numbers', () => {
    expect(
      sanitizeAuditDetails({
        reason: `a\n${'b'.repeat(500)}`,
        size: Infinity,
        roleIds: Array.from({ length: 150 }, (_, index) => String(index)),
        before: {
          before: { before: { before: { before: { name: 'hidden' } } } },
        },
      })
    ).toEqual({
      reason: `a ${'b'.repeat(298)}`,
      roleIds: Array.from({ length: 100 }, (_, index) => String(index)),
      before: { before: { before: { before: { before: {} } } } },
    })
  })

  it('keeps concurrent actors isolated and correlates model events with request results', async () => {
    const handler = withAuditRoute(
      async (request: Request) => {
        const name = request.headers.get('fixture-actor')!
        setAuditActor({ id: name, name })
        await new Promise((resolve) =>
          setTimeout(resolve, name === 'Alex' ? 5 : 1)
        )
        await recordAudit({
          action: 'file.create',
          category: 'files',
          targetName: `${name}.pdf`,
        })
        return new Response(null, { status: 201 })
      },
      { route: '/api/files' }
    )
    await Promise.all(
      ['Alex', 'Morgan'].map((name) =>
        handler(
          new Request('http://localhost/api/files?token=never-record', {
            method: 'POST',
            headers: { 'fixture-actor': name },
          })
        )
      )
    )
    const created = events.filter((event) => event.action === 'file.create')
    expect(created.map((event) => [event.actorName, event.targetName])).toEqual(
      [
        ['Morgan', 'Morgan.pdf'],
        ['Alex', 'Alex.pdf'],
      ]
    )
    for (const event of created)
      expect(
        events.find(
          (other) =>
            other.action === 'http.post' && other.requestId === event.requestId
        )?.actorId
      ).toBe(event.actorId)
    expect(new Set(created.map((event) => event.requestId)).size).toBe(2)
    expect(JSON.stringify(events)).not.toContain('never-record')
  })

  it('supports zero-argument route bodies and identifies denied/error outcomes without response secrets', async () => {
    await withAuditRoute(
      async () => new Response('private permission context', { status: 403 }),
      { route: '/api/users/[id]' }
    )(new Request('http://localhost/api/users/raw-secret'))
    await expect(
      withAuditRoute(async () => {
        throw new Error('private stack')
      })(new Request('http://localhost/api/folders/share/secret-share-token'))
    ).rejects.toThrow('private stack')
    expect(events.map((event) => event.outcome)).toEqual(['denied', 'failure'])
    expect(events[0]).toMatchObject({
      route: '/api/users/[id]',
      actorName: 'Anonymous',
      status: 403,
    })
    expect(JSON.stringify(events)).not.toMatch(
      /private stack|private permission|secret-share-token|raw-secret/
    )
  })

  it('does not change application results when audit storage fails and logs no raw input', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureAuditWriter(async () => {
      throw new Error('secret database URL')
    })
    const response = await withAuditRoute(async () => new Response('done'))(
      new Request('http://localhost/api/files')
    )
    expect(await response.text()).toBe('done')
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls.flat().join(' ')).not.toContain(
      'secret database URL'
    )
    error.mockRestore()
  })
})

describe('audit filters and authorization contract', () => {
  it('defaults to 50 events and grants access only through explicit audit permission or Administrator', () => {
    expect(auditQuerySchema.parse({})).toEqual({ page: 1, limit: 50 })
    expect(DEFAULT_PERMISSIONS).not.toContain('audit.read')
    expect(
      hasPermission(
        { permissions: ['settings.read', 'content.read'] },
        'audit.read'
      )
    ).toBe(false)
    expect(hasPermission({ permissions: ['audit.read'] }, 'audit.read')).toBe(
      true
    )
    expect(
      hasPermission({ permissions: ['administrator'] }, 'audit.read')
    ).toBe(true)
  })
  it.each([
    { page: 0 },
    { page: 100001 },
    { page: 1.2 },
    { limit: 101 },
    { limit: 'x' },
    { q: 'a'.repeat(201) },
    { outcome: 'unknown' },
    { from: '2026-10-01' },
    { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    { unexpected: 'field' },
  ])('rejects invalid or unbounded filters: %j', (query) => {
    expect(auditQuerySchema.safeParse(query).success).toBe(false)
  })
  it('combines filters with inclusive timestamps and a case-insensitive name/action search', () => {
    const where = auditWhere(
      auditQuerySchema.parse({
        q: 'invoice',
        actorId: 'actor-1',
        targetId: 'file-1',
        requestId: 'request-1',
        category: 'files',
        action: 'file.delete',
        outcome: 'failure',
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
      })
    )
    expect(where).toMatchObject({
      actorId: 'actor-1',
      targetId: 'file-1',
      requestId: 'request-1',
      category: 'files',
      action: 'file.delete',
      outcome: 'failure',
      createdAt: {
        gte: new Date('2026-10-01T00:00:00Z'),
        lte: new Date('2026-10-02T00:00:00Z'),
      },
    })
    expect(where.OR).toContainEqual({
      targetName: { contains: 'invoice', mode: 'insensitive' },
    })
  })
})
