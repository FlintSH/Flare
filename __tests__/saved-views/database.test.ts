import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { savedViewInputSchema } from '@/lib/saved-views/schema'

const authentication = vi.hoisted(() => ({ userId: 'saved-view-owner' }))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: authentication.userId, role: 'ADMIN' },
  }),
}))

const databaseUrl = process.env.FLARE_SAVED_VIEWS_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('saved views against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/saved-views/service')
  let routes: typeof import('@/app/api/saved-views/route')
  let item: typeof import('@/app/api/saved-views/[id]/route')
  let appearance: typeof import('@/app/api/customization/preferences/route')
  let folders: typeof import('@/lib/folders/service')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!/^flare_saved_views_test_/.test(url.searchParams.get('schema') ?? '') &&
        !/^\/flare_saved_views_test_/.test(url.pathname))
    )
      throw new Error(
        'Use a disposable local flare_saved_views_test_ database or schema'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/saved-views/service')
    routes = await import('@/app/api/saved-views/route')
    item = await import('@/app/api/saved-views/[id]/route')
    appearance = await import('@/app/api/customization/preferences/route')
    folders = await import('@/lib/folders/service')
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    for (const id of ['saved-view-owner', 'saved-view-other'])
      await prisma.user.create({
        data: {
          id,
          name: id,
          urlId: id,
          uploadToken: id,
          preferences: { unrelated: 'preserve me' },
        },
      })
    authentication.userId = 'saved-view-owner'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function request(method: string, body?: unknown, path = '/api/saved-views') {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  function input(name: string, filters = {}) {
    return savedViewInputSchema.parse({ name, filters })
  }

  it('keeps views isolated by account including administrator sessions, and deletes only the shortcut', async () => {
    const created = await routes.POST(
      request(
        'POST',
        input('Screenshot journal', { types: ['image/png'], groupBy: 'month' })
      )
    )
    expect(created.status).toBe(200)
    const view = (await created.json()).data
    expect(view).toMatchObject({
      name: 'Screenshot journal',
      pinned: true,
      revision: 1,
      unavailableReason: null,
    })
    const file = await prisma.file.create({
      data: {
        userId: authentication.userId,
        name: 'screenshot.png',
        urlPath: '/saved-view-owner/screenshot.png',
        path: 'untouched-path',
        mimeType: 'image/png',
        size: 1,
      },
    })
    authentication.userId = 'saved-view-other'
    expect((await (await routes.GET(request('GET'))).json()).data).toEqual([])
    const context = { params: Promise.resolve({ id: view.id }) }
    expect(
      (
        await item.PATCH(
          request('PATCH', { revision: 1, name: 'Hijacked' }),
          context
        )
      ).status
    ).toBe(404)
    expect(
      (await item.DELETE(request('DELETE', { revision: 1 }), context)).status
    ).toBe(404)
    authentication.userId = 'saved-view-owner'
    expect(
      (await item.DELETE(request('DELETE', { revision: 1 }), context)).status
    ).toBe(200)
    expect(await service.listSavedViews(authentication.userId)).toEqual([])
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toEqual(
      file
    )
  })

  it('serializes duplicate creation and the 20-view limit under concurrent requests', async () => {
    const duplicate = await Promise.allSettled([
      service.createSavedView(authentication.userId, input('Inbox')),
      service.createSavedView(authentication.userId, input('INBOX')),
    ])
    expect(
      duplicate.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    for (let index = 1; index < 19; index++)
      await service.createSavedView(
        authentication.userId,
        input(`View ${index}`)
      )
    const finalSlot = await Promise.allSettled([
      service.createSavedView(authentication.userId, input('Last one')),
      service.createSavedView(authentication.userId, input('One too many')),
    ])
    expect(
      finalSlot.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(await service.listSavedViews(authentication.userId)).toHaveLength(20)
  })

  it('preserves concurrent appearance changes and rejects stale same-view updates or deletion', async () => {
    const [view, appearanceResponse] = await Promise.all([
      service.createSavedView(authentication.userId, input('Inbox')),
      appearance.PATCH(
        request(
          'PATCH',
          { themeMode: 'dark' },
          '/api/customization/preferences'
        )
      ),
    ])
    expect(appearanceResponse.status).toBe(200)
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: authentication.userId },
        })
      ).preferences
    ).toMatchObject({
      unrelated: 'preserve me',
      customization: { themeMode: 'dark' },
      savedViews: [{ id: view.id }],
    })
    const changes = await Promise.allSettled([
      service.updateSavedView(authentication.userId, view.id, {
        revision: 1,
        name: 'Renamed',
      }),
      service.updateSavedView(authentication.userId, view.id, {
        revision: 1,
        pinned: false,
      }),
    ])
    expect(
      changes.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      changes.find((result) => result.status === 'rejected')
    ).toMatchObject({ reason: { status: 409, code: 'SAVED_VIEW_STALE' } })
    await expect(
      service.deleteSavedView(authentication.userId, view.id, 1)
    ).rejects.toMatchObject({ status: 409 })
    expect(
      (await service.listSavedViews(authentication.userId))[0].revision
    ).toBe(2)
  })

  it('rejects foreign references, preserves deleted filters as unavailable, and repairs explicitly', async () => {
    const folder = await folders.createFolder(authentication.userId, {
      name: 'Receipts',
      parentId: null,
    })
    const tag = await prisma.vaultTag.create({
      data: {
        userId: authentication.userId,
        name: 'Receipts',
        normalizedName: 'receipts',
      },
    })
    for (const filters of [{ folder: folder.id }, { tag: tag.id }])
      await expect(
        service.createSavedView('saved-view-other', input('Foreign', filters))
      ).rejects.toMatchObject({ status: 404 })
    const view = await service.createSavedView(
      authentication.userId,
      input('Receipts', { folder: folder.id, tag: tag.id })
    )
    await folders.deleteFolder(authentication.userId, folder.id)
    // Direct tag removal is enough to exercise saved-reference recovery; folder
    // service above exercises the deletion lock used by actual UI mutations.
    await prisma.vaultTag.delete({ where: { id: tag.id } })
    expect(
      (await service.listSavedViews(authentication.userId))[0]
    ).toMatchObject({
      filters: { folder: folder.id, tag: tag.id },
      unavailableReason: expect.stringContaining('folder and tag'),
    })
    const renamed = await service.updateSavedView(
      authentication.userId,
      view.id,
      { revision: 1, name: 'Old receipts', pinned: false }
    )
    expect(renamed.unavailableReason).not.toBeNull()
    const repaired = await service.updateSavedView(
      authentication.userId,
      view.id,
      {
        revision: renamed.revision,
        filters: input('Repair', { folder: 'unfiled', tag: 'untagged' })
          .filters,
      }
    )
    expect(repaired).toMatchObject({
      unavailableReason: null,
      filters: { folder: 'unfiled', tag: 'untagged' },
      revision: 3,
    })
  })

  it('handles saved-view creation racing folder deletion without widening its filter', async () => {
    const folder = await folders.createFolder(authentication.userId, {
      name: 'Temporary',
      parentId: null,
    })
    await Promise.allSettled([
      service.createSavedView(
        authentication.userId,
        input('Temporary view', { folder: folder.id })
      ),
      folders.deleteFolder(authentication.userId, folder.id),
    ])
    const views = await service.listSavedViews(authentication.userId)
    expect(views.length).toBeLessThanOrEqual(1)
    if (views.length)
      expect(views[0]).toMatchObject({
        filters: { folder: folder.id },
        unavailableReason: expect.any(String),
      })
  })
})
