import { DELETE as deleteOwnFile } from '@/app/api/files/[id]/route'
import { DELETE as deleteUserFile } from '@/app/api/users/[id]/files/[fileId]/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter, setAuditActor } from '@/lib/audit'

const state = vi.hoisted(() => ({
  remove: vi.fn(),
  findFile: vi.fn(),
  deleteFile: vi.fn(),
  updateUser: vi.fn(),
  actorId: 'owner',
  denied: false,
}))
vi.mock('@/lib/database/prisma', () => {
  const tx = {
    file: { findUnique: state.findFile, delete: state.deleteFile },
    user: { update: state.updateUser },
  }
  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
    },
  }
})
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: state.remove }),
}))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))
vi.mock('@/lib/permissions/server', () => ({
  requirePermission: async () => {
    if (state.denied)
      return {
        response: new Response('Denied', { status: 403 }),
        session: null,
      }
    setAuditActor({
      id: state.actorId,
      name: state.actorId === 'owner' ? 'File owner' : 'Admin reviewer',
    })
    return { response: null, session: { user: { id: state.actorId } } }
  },
}))

const recorded: Array<Record<string, unknown>> = []
const file = {
  id: 'file-one',
  name: 'meeting-notes.txt',
  userId: 'owner',
  path: '/private-storage/path-not-for-audit',
  size: 12,
}
const request = (path: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  recorded.length = 0
  state.actorId = 'owner'
  state.denied = false
  state.findFile.mockResolvedValue(file)
  state.remove.mockResolvedValue(undefined)
  configureAuditWriter(async (data) => {
    recorded.push(data as Record<string, unknown>)
  })
})

describe('file storage audit evidence', () => {
  it.each(['owner', 'admin'])(
    'retains a %s deletion storage failure even when metadata deletion succeeds',
    async (actor) => {
      state.actorId = actor
      state.remove.mockRejectedValueOnce(
        new Error('private-storage-password-and-host')
      )
      const response =
        actor === 'owner'
          ? await deleteOwnFile(request('/api/files/file-one'), {
              params: Promise.resolve({ id: file.id }),
            })
          : await deleteUserFile(request('/api/users/owner/files/file-one'), {
              params: Promise.resolve({ id: 'owner', fileId: file.id }),
            })
      expect(response.status).toBe(actor === 'owner' ? 200 : 204)
      expect(state.deleteFile).toHaveBeenCalledOnce()
      expect(
        recorded.find((row) => row.action === 'storage.delete_failed')
      ).toMatchObject({
        actorId: actor,
        outcome: 'failure',
        targetId: file.id,
        targetName: file.name,
        details: { ownerId: 'owner' },
      })
      expect(
        recorded.find((row) => row.action === 'http.delete')
      ).toMatchObject({
        outcome: 'success',
        targetId: file.id,
        targetName: file.name,
      })
      expect(JSON.stringify(recorded)).not.toMatch(/private-storage/)
    }
  )

  it('records successful physical deletion distinctly from the response status', async () => {
    await deleteOwnFile(request('/api/files/file-one'), {
      params: Promise.resolve({ id: file.id }),
    })
    expect(
      recorded.find((row) => row.action === 'storage.deleted')
    ).toMatchObject({
      actorId: 'owner',
      outcome: 'success',
      targetName: file.name,
    })
    expect(recorded.some((row) => row.action === 'storage.delete_failed')).toBe(
      false
    )
  })

  it('does not reveal file metadata or touch storage when authority is rejected', async () => {
    state.denied = true
    const response = await deleteUserFile(
      request('/api/users/owner/files/file-one'),
      { params: Promise.resolve({ id: 'owner', fileId: file.id }) }
    )
    expect(response.status).toBe(403)
    expect(state.findFile).not.toHaveBeenCalled()
    expect(state.remove).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      action: 'http.delete',
      outcome: 'denied',
    })
    expect(recorded[0].targetName).toBeUndefined()
  })
})
