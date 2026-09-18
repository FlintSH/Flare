import { randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const authentication = vi.hoisted(() => ({ userId: 'tag-owner' }))
vi.mock('@/lib/auth/api-auth', () => ({
  requireAuth: async () => ({
    user: { id: authentication.userId, role: 'ADMIN' },
    response: null,
  }),
}))

const databaseUrl = process.env.FLARE_TAGS_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('vault tags against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/tags/service')
  let tags: typeof import('@/app/api/tags/route')
  let tag: typeof import('@/app/api/tags/[id]/route')
  let bulk: typeof import('@/app/api/files/tags/route')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!/^flare_tags_test_/.test(url.searchParams.get('schema') ?? '') &&
        !/^\/flare_tags_test_/.test(url.pathname))
    )
      throw new Error(
        'Use a disposable local flare_tags_test_ database or schema'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/tags/service')
    tags = await import('@/app/api/tags/route')
    tag = await import('@/app/api/tags/[id]/route')
    bulk = await import('@/app/api/files/tags/route')
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    for (const id of ['tag-owner', 'tag-other']) {
      await prisma.user.create({
        data: { id, name: id, urlId: id, uploadToken: id },
      })
    }
    authentication.userId = 'tag-owner'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function request(path = '/api/tags', method = 'GET', data?: unknown) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
  }

  async function newTag(input: {
    name: string
    ruleSource?: string
    ruleText?: string
  }) {
    const response = await tags.POST(request('/api/tags', 'POST', input))
    expect(response.status).toBe(200)
    return (await response.json()).data as {
      id: string
      name: string
      fileCount: number
    }
  }

  async function file(userId = 'tag-owner', name = 'Invoice.png') {
    return prisma.file.create({
      data: {
        userId,
        name,
        urlPath: `/${randomUUID()}`,
        path: 'unused-fixture-path',
        mimeType: 'image/png',
        size: 100,
        ocrText: 'Invoice from Acme',
      },
    })
  }

  it('normalizes duplicate names per owner and scopes private tag lists', async () => {
    const saved = await newTag({ name: '  Ｗork   docs ' })
    expect(saved.name).toBe('Work docs')
    expect(
      (await tags.POST(request('/api/tags', 'POST', { name: 'work DOCS' })))
        .status
    ).toBe(409)
    authentication.userId = 'tag-other'
    expect((await (await tags.GET(request())).json()).data).toEqual([])
    await newTag({ name: 'work docs' })
    expect(await prisma.vaultTag.count()).toBe(2)
  })

  it('rejects cross-account CRUD and mixed file selection, even for administrators', async () => {
    const saved = await newTag({ name: 'Work' })
    const ownFile = await file()
    const foreignFile = await file('tag-other')
    const changed = await bulk.PATCH(
      request('/api/files/tags', 'PATCH', {
        fileIds: [ownFile.id, foreignFile.id],
        tagId: saved.id,
        action: 'add',
      })
    )
    expect(changed.status).toBe(404)
    expect(await prisma.vaultFileTag.count()).toBe(0)
    authentication.userId = 'tag-other'
    const context = { params: Promise.resolve({ id: saved.id }) }
    expect(
      (
        await tag.PATCH(
          request(`/api/tags/${saved.id}`, 'PATCH', { name: 'Hijacked' }),
          context
        )
      ).status
    ).toBe(404)
    expect(
      (await tag.DELETE(request(`/api/tags/${saved.id}`, 'DELETE'), context))
        .status
    ).toBe(404)
    await expect(
      service.applyTagToExistingFiles('tag-other', saved.id)
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await prisma.vaultTag.findUniqueOrThrow({ where: { id: saved.id } })
    ).toMatchObject({ name: 'Work', userId: 'tag-owner' })
  })

  it('keeps manual removals through automatic OCR retries and explicit rule backfills', async () => {
    const saved = await newTag({
      name: 'Receipts',
      ruleSource: 'ocr',
      ruleText: 'acme',
    })
    const ownFile = await file()
    await file('tag-other')
    expect(await service.applyAutomaticTags(ownFile.id, 'filename')).toBe(0)
    expect(await service.applyAutomaticTags(ownFile.id, 'ocr')).toBe(1)
    expect(await service.applyAutomaticTags(ownFile.id, 'ocr')).toBe(0)
    await service.changeFileTags('tag-owner', {
      fileIds: [ownFile.id],
      tagId: saved.id,
      action: 'remove',
    })
    expect(await service.applyAutomaticTags(ownFile.id, 'ocr')).toBe(0)
    expect(await service.applyTagToExistingFiles('tag-owner', saved.id)).toBe(0)
    expect((await (await tags.GET(request())).json()).data[0].fileCount).toBe(0)
    expect(
      await prisma.file.count({
        where: { userId: 'tag-owner', tags: { none: { excluded: false } } },
      })
    ).toBe(1)
    await service.changeFileTags('tag-owner', {
      fileIds: [ownFile.id],
      tagId: saved.id,
      action: 'add',
    })
    expect((await (await tags.GET(request())).json()).data[0].fileCount).toBe(1)
    expect(
      await prisma.file.count({
        where: {
          userId: 'tag-owner',
          tags: { some: { tagId: saved.id, excluded: false } },
        },
      })
    ).toBe(1)
  })

  it('applies literal filenames only on request and leaves existing assignments after a rule edit', async () => {
    const saved = await newTag({
      name: 'Discounts',
      ruleSource: 'filename',
      ruleText: '20%_',
    })
    const match = await file('tag-owner', '20%_sale.png')
    await file('tag-owner', '2000_sale.png')
    await file('tag-other', '20%_sale.png')
    expect(await prisma.vaultFileTag.count()).toBe(0)
    expect(await service.applyTagToExistingFiles('tag-owner', saved.id)).toBe(1)
    expect(await prisma.vaultFileTag.findMany()).toMatchObject([
      { fileId: match.id, tagId: saved.id, excluded: false },
    ])
    await tag.PATCH(
      request(`/api/tags/${saved.id}`, 'PATCH', {
        name: 'Discounts',
        ruleSource: 'filename',
        ruleText: 'something-else',
      }),
      { params: Promise.resolve({ id: saved.id }) }
    )
    expect(await service.applyTagToExistingFiles('tag-owner', saved.id)).toBe(0)
    expect(
      await prisma.vaultFileTag.count({ where: { excluded: false } })
    ).toBe(1)
  })

  it('removes only the tag and its profile references, preserving files and other defaults', async () => {
    const saved = await newTag({ name: 'Work' })
    const retained = await newTag({ name: 'Other' })
    const ownFile = await file()
    await service.changeFileTags('tag-owner', {
      fileIds: [ownFile.id],
      tagId: saved.id,
      action: 'add',
    })
    const profile = await prisma.uploadProfile.create({
      data: {
        name: 'Screenshot',
        userId: 'tag-owner',
        options: {
          tagIds: [saved.id, retained.id],
          visibility: 'PRIVATE',
          shareStyle: 'minimal',
        },
      },
    })
    expect(
      (
        await tag.DELETE(request(`/api/tags/${saved.id}`, 'DELETE'), {
          params: Promise.resolve({ id: saved.id }),
        })
      ).status
    ).toBe(200)
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.vaultFileTag.count()).toBe(0)
    expect(
      (
        await prisma.uploadProfile.findUniqueOrThrow({
          where: { id: profile.id },
        })
      ).options
    ).toEqual({
      tagIds: [retained.id],
      visibility: 'PRIVATE',
      shareStyle: 'minimal',
    })
  })

  it('rejects foreign profile tags before applying any association', async () => {
    const saved = await newTag({ name: 'Work' })
    const foreignFile = await file('tag-other')
    await expect(
      prisma.$transaction((tx) =>
        service.applyProfileTags(tx, foreignFile, [saved.id])
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(await prisma.vaultFileTag.count()).toBe(0)
  })
})
