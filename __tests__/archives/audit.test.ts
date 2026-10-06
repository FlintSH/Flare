import { GET as listArchive } from '@/app/api/files/[id]/archive/route'
import { POST as sharedEntry } from '@/app/api/files/[id]/archive/share/entry/route'
import { POST as sharedListing } from '@/app/api/files/[id]/archive/share/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ArchiveError } from '@/lib/archives/errors'
import { archiveRoute } from '@/lib/archives/http'
import {
  configureAuditWriter,
  setAuditTarget,
  withAuditRoute,
} from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; sessionVersion: number } },
  user: { id: 'owner', name: 'Alex', sessionVersion: 1 },
  file: {
    id: 'archive-file',
    name: 'Documents.zip',
    userId: 'owner',
    visibility: 'PRIVATE',
    password: 'never-store-password-hash',
    path: '/private/storage/object',
  },
  list: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => state.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: async () => state.user },
    file: { findUnique: async () => state.file },
  },
}))
vi.mock('@/lib/permissions/server', () => ({
  getUserAccess: async () => ({ roles: [], permissions: ['files.read'] }),
  lockRoleChanges: vi.fn(),
  PermissionError: class extends Error {
    status = 403
  },
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: async () => ({}),
  getEmailConfigForUpdate: async () => ({}),
}))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: () => false,
}))
vi.mock('@/lib/archives/service', () => ({
  listArchive: state.list,
  listSharedArchive: state.list,
  downloadSharedArchiveEntry: state.list,
}))
vi.mock('@/lib/archives/operation', () => ({
  withArchiveOperation: async (
    _id: string,
    _signal: AbortSignal,
    action: (operation: object) => unknown
  ) => action({}),
}))
vi.mock('@/lib/storage/target-provider', () => ({
  StorageTargetChangedError: class extends Error {},
}))
vi.mock('@/lib/logger', () => ({
  loggers: { files: { error: vi.fn(), warn: vi.fn() } },
}))

const events: Record<string, unknown>[] = []
const params = { params: Promise.resolve({ id: 'archive-file' }) }
function sharedRequest(
  body: string,
  path = '/api/files/archive-file/archive/share'
) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body,
  })
}

beforeEach(() => {
  events.length = 0
  state.session = null
  state.file.visibility = 'PRIVATE'
  state.list.mockReset()
  configureAuditWriter(async (event) => {
    events.push(event)
  })
})

describe('archive route audit integration', () => {
  it('propagates a final masked denial from transaction context to the request outcome', async () => {
    const response = await withAuditRoute(
      async () =>
        archiveRoute(async () => {
          await auditContext.run({ ...auditContext.getStore() }, async () => {
            throw new ArchiveError('Archive not found.', 404, true)
          })
        }),
      { action: 'archive.browse', category: 'archives' }
    )(new Request('http://localhost/api/files/archive-file/archive/share'))
    expect(response.status).toBe(404)
    expect(events[0]).toMatchObject({ outcome: 'denied' })
  })
  it('keeps a masked private-file404 classified as denied and records the known archive filename', async () => {
    const response = await sharedListing(
      sharedRequest(
        JSON.stringify({ password: 'never-store-submitted-password' })
      ),
      params
    )
    expect(response.status).toBe(404)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'archive.browse',
      category: 'archives',
      outcome: 'denied',
      actorName: 'Anonymous',
      targetId: 'archive-file',
      targetName: 'Documents.zip',
      route: '/api/files/[id]/archive/share',
    })
    expect(JSON.stringify(events)).not.toMatch(/never-store|private\/storage/)
    expect(state.list).not.toHaveBeenCalled()
  })

  it('binds the authenticated archive owner to request events', async () => {
    state.session = { user: { id: 'owner', sessionVersion: 1 } }
    state.list.mockImplementation(async () => {
      setAuditTarget({
        type: 'file',
        id: 'archive-file',
        name: 'Documents.zip',
      })
      return { entries: [], fileCount: 0 }
    })
    const response = await listArchive(
      new Request('http://localhost/api/files/archive-file/archive'),
      params
    )
    expect(response.status).toBe(200)
    expect(events[0]).toMatchObject({
      action: 'archive.browse',
      actorId: 'owner',
      actorName: 'Alex',
      targetName: 'Documents.zip',
      outcome: 'success',
    })
  })

  it('records malformed entry requests without copying bodies or query strings into the log', async () => {
    const response = await sharedEntry(
      sharedRequest(
        '{"password":"secret-body',
        '/api/files/archive-file/archive/share/entry?private-query=secret'
      ),
      params
    )
    expect(response.status).toBe(400)
    expect(events[0]).toMatchObject({
      action: 'archive.entry.read',
      outcome: 'failure',
      targetId: 'archive-file',
      route: '/api/files/[id]/archive/share/entry',
    })
    expect(JSON.stringify(events)).not.toMatch(/secret-body|private-query/)
  })

  it('audits unexpected archive failures without preserving raw errors', async () => {
    state.session = { user: { id: 'owner', sessionVersion: 1 } }
    state.list.mockRejectedValue(new Error('private-storage-key'))
    expect(
      (
        await listArchive(
          new Request('http://localhost/api/files/archive-file/archive'),
          params
        )
      ).status
    ).toBe(500)
    expect(events[0]).toMatchObject({
      action: 'archive.browse',
      outcome: 'failure',
      actorId: 'owner',
    })
    expect(JSON.stringify(events)).not.toContain('private-storage-key')
  })
})
