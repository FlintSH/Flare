import { PUT } from '@/app/api/upload-profiles/[id]/route'
import { POST } from '@/app/api/upload-profiles/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  vaultTag: { count: vi.fn() },
  uploadProfile: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: database }))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: {
      id: 'alice',
      permissions: ['uploadProfiles.manage', 'tags.manage'],
    },
  }),
}))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))

const revision = '2026-09-18T00:00:00.000Z'
const profile = { name: 'Work', options: { tagIds: ['work'] } }
function request(body: unknown, method = 'POST') {
  return new Request('https://flare.test/api/upload-profiles', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://flare.test',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  database.$transaction.mockImplementation((callback) => callback(database))
  database.vaultTag.count.mockResolvedValue(1)
  database.uploadProfile.create.mockImplementation(async ({ data }) => ({
    ...data,
    id: 'profile',
    updatedAt: new Date(revision),
  }))
  database.uploadProfile.updateMany.mockResolvedValue({ count: 1 })
  database.uploadProfile.findUniqueOrThrow.mockResolvedValue({
    ...profile,
    id: 'profile',
    updatedAt: new Date(revision),
  })
})

describe('upload profile tag ownership', () => {
  it.each(['profile', 'recipe'])(
    'checks tag ownership when creating a %s',
    async (kind) => {
      const body =
        kind === 'recipe'
          ? { format: 'flare-upload-profile', version: 1, profile }
          : profile
      const response = await POST(request(body))
      expect(response.status).toBe(201)
      expect(database.vaultTag.count).toHaveBeenCalledWith({
        where: { userId: 'alice', id: { in: ['work'] } },
      })
      expect((await response.json()).data.options.tagIds).toEqual(['work'])
    }
  )

  it.each(['profile', 'recipe'])(
    'rejects missing or foreign tags in a %s without creating it',
    async (kind) => {
      database.vaultTag.count.mockResolvedValue(0)
      const body =
        kind === 'recipe'
          ? { format: 'flare-upload-profile', version: 1, profile }
          : profile
      const response = await POST(request(body))
      expect(response.status).toBe(400)
      expect(database.uploadProfile.create).not.toHaveBeenCalled()
    }
  )

  it('checks ownership again on edit and preserves the previous profile on failure', async () => {
    database.vaultTag.count.mockResolvedValue(0)
    const response = await PUT(request({ ...profile, revision }, 'PUT'), {
      params: Promise.resolve({ id: 'profile' }),
    })
    expect(response.status).toBe(400)
    expect(database.uploadProfile.updateMany).not.toHaveBeenCalled()
  })

  it('keeps recipes without tags compatible and permits clearing all selected tags', async () => {
    const response = await POST(request({ ...profile, options: {} }))
    expect(response.status).toBe(201)
    const edited = await PUT(
      request({ ...profile, options: { tagIds: [] }, revision }, 'PUT'),
      { params: Promise.resolve({ id: 'profile' }) }
    )
    expect(edited.status).toBe(200)
    expect(database.vaultTag.count).not.toHaveBeenCalled()
    expect(database.uploadProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'profile', userId: 'alice', updatedAt: new Date(revision) },
      data: { ...profile, options: { tagIds: [] } },
    })
  })

  it('reports a revision conflict after another change instead of overwriting it', async () => {
    database.uploadProfile.updateMany.mockResolvedValue({ count: 0 })
    const response = await PUT(request({ ...profile, revision }, 'PUT'), {
      params: Promise.resolve({ id: 'profile' }),
    })
    expect(response.status).toBe(409)
    expect(database.uploadProfile.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
