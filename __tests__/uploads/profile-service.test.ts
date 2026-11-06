import { DELETE as deleteTag } from '@/app/api/tags/[id]/route'
import { GET as exportRecipe } from '@/app/api/upload-profiles/[id]/export/route'
import { PUT as chooseDefault } from '@/app/api/upload-profiles/default/route'
import { GET, POST } from '@/app/api/upload-profiles/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RECIPE_MAX_BYTES, uploadRecipeSchema } from '@/lib/uploads/schema'

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  vaultTag: { count: vi.fn(), deleteMany: vi.fn() },
  uploadProfile: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: database }))
const owner = vi.hoisted(() => ({
  id: 'alice',
  permissions: ['uploadProfiles.manage', 'tags.manage'],
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({ user: owner }),
}))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: async () => owner,
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'framed' } } },
    },
  }),
}))

const updatedAt = new Date('2026-09-18T00:00:00.000Z')
const saved = {
  id: 'screenshots',
  userId: 'alice',
  name: 'Screenshots',
  options: { visibility: 'PRIVATE', expiration: 'DAY', copyFormat: 'raw' },
  updatedAt,
}

function request(path: string, method = 'GET', body?: string) {
  return new Request(`https://flare.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://flare.test',
    },
    body,
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.resetAllMocks()
  database.$transaction.mockImplementation((callback) => callback(database))
  database.uploadProfile.create.mockImplementation(async ({ data }) => ({
    ...data,
    id: 'created',
    updatedAt,
  }))
})

describe('upload profile requests', () => {
  it('takes the profile lock before checking a new profile’s tags', async () => {
    database.vaultTag.count.mockResolvedValue(1)
    const response = await POST(
      request(
        '/api/upload-profiles',
        'POST',
        JSON.stringify({ name: 'Work', options: { tagIds: ['work'] } })
      )
    )
    expect(response.status).toBe(201)
    expect(database.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      database.vaultTag.count.mock.invocationCallOrder[0]
    )
  })

  it('reads create and import bodies up to the recipe limit and refuses larger ones', async () => {
    const recipe = JSON.stringify({
      format: 'flare-upload-profile',
      version: 1,
      profile: { name: 'Padded', options: {} },
    })
    const padded = (bytes: number) =>
      recipe + ' '.repeat(bytes - Buffer.byteLength(recipe))

    const atLimit = await POST(
      request('/api/upload-profiles', 'POST', padded(RECIPE_MAX_BYTES))
    )
    expect(atLimit.status).toBe(201)
    expect((await atLimit.json()).data.name).toBe('Padded')

    database.uploadProfile.create.mockClear()
    const tooLarge = await POST(
      request('/api/upload-profiles', 'POST', padded(RECIPE_MAX_BYTES + 1))
    )
    expect(tooLarge.status).toBe(413)
    expect(await tooLarge.json()).toEqual({
      error: 'Request body is too large.',
    })
    expect(database.uploadProfile.create).not.toHaveBeenCalled()
  })

  it('exports the recipe the importer reads back, without retired options', async () => {
    database.uploadProfile.findFirst.mockResolvedValue(saved)
    const response = await exportRecipe(
      request('/api/upload-profiles/screenshots/export'),
      params('screenshots')
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="flare-upload-profile.json"'
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const text = await response.text()
    const recipe = {
      format: 'flare-upload-profile',
      version: 1,
      profile: {
        name: 'Screenshots',
        options: { visibility: 'PRIVATE', expiration: 'DAY' },
      },
    }
    expect(text).toBe(JSON.stringify(recipe, null, 2))
    expect(uploadRecipeSchema.parse(JSON.parse(text))).toEqual(recipe)
    expect(database.uploadProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'screenshots', userId: 'alice' },
    })
  })

  it('keeps each route’s answer for a profile that is not the account’s', async () => {
    database.uploadProfile.findFirst.mockResolvedValue(null)
    const exported = await exportRecipe(
      request('/api/upload-profiles/foreign/export'),
      params('foreign')
    )
    expect(exported.status).toBe(404)
    expect(await exported.json()).toEqual({ error: 'Profile not found.' })

    const chosen = await chooseDefault(
      request(
        '/api/upload-profiles/default',
        'PUT',
        JSON.stringify({ profileId: 'foreign' })
      )
    )
    expect(chosen.status).toBe(404)
    expect(await chosen.json()).toEqual({ error: 'Profile not found.' })
    expect(database.user.update).not.toHaveBeenCalled()
  })

  it('names a vanished account instead of answering a bare 401', async () => {
    database.uploadProfile.findMany.mockResolvedValue([])
    database.user.findUnique.mockResolvedValue(null)
    const response = await GET(request('/api/upload-profiles'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Account no longer exists.',
    })
  })
})

describe('tag deletion and saved profiles', () => {
  it('locks the profiles before deleting the tag, then takes it out of the profiles that select it', async () => {
    database.vaultTag.deleteMany.mockResolvedValue({ count: 1 })
    database.uploadProfile.findMany.mockResolvedValue([
      {
        id: 'work',
        options: { tagIds: ['receipts', 'work'], copyFormat: 'raw' },
      },
      { id: 'plain', options: { visibility: 'PUBLIC' } },
      { id: 'other-tags', options: { tagIds: ['work'] } },
    ])
    const response = await deleteTag(
      request('/api/tags/receipts', 'DELETE'),
      params('receipts')
    )
    expect(response.status).toBe(200)
    expect(database.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      database.vaultTag.deleteMany.mock.invocationCallOrder[0]
    )
    expect(database.uploadProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'alice' } })
    )
    expect(database.uploadProfile.update).toHaveBeenCalledTimes(1)
    expect(database.uploadProfile.update).toHaveBeenCalledWith({
      where: { id: 'work' },
      data: { options: { tagIds: ['work'], copyFormat: 'raw' } },
    })
  })

  it('leaves profiles alone when the tag is not the account’s', async () => {
    database.vaultTag.deleteMany.mockResolvedValue({ count: 0 })
    const response = await deleteTag(
      request('/api/tags/foreign', 'DELETE'),
      params('foreign')
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Tag not found.',
    })
    expect(database.uploadProfile.findMany).not.toHaveBeenCalled()
    expect(database.uploadProfile.update).not.toHaveBeenCalled()
  })
})
