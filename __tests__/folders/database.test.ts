import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const authentication = vi.hoisted(() => ({ userId: 'folder-owner' }))
vi.mock('@/lib/auth/api-auth', () => ({
  requireAuth: async () => ({
    user: { id: authentication.userId, role: 'ADMIN' },
    response: null,
  }),
}))
vi.mock('@/lib/events/handlers/file-expiry', () => ({
  getFileExpirationInfo: async () => null,
}))

const databaseUrl = process.env.FLARE_FOLDERS_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('vault folders against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/folders/service')
  let shared: typeof import('@/lib/folders/shared')
  let folders: typeof import('@/app/api/folders/route')
  let folder: typeof import('@/app/api/folders/[id]/route')
  let files: typeof import('@/app/api/files/route')
  let bulk: typeof import('@/app/api/files/folders/route')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!/^flare_folders_test_/.test(url.searchParams.get('schema') ?? '') &&
        !/^\/flare_folders_test_/.test(url.pathname))
    ) {
      throw new Error(
        'Use a disposable local flare_folders_test_ database or schema'
      )
    }
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/folders/service')
    shared = await import('@/lib/folders/shared')
    folders = await import('@/app/api/folders/route')
    folder = await import('@/app/api/folders/[id]/route')
    files = await import('@/app/api/files/route')
    bulk = await import('@/app/api/files/folders/route')
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    for (const id of ['folder-owner', 'folder-other']) {
      await prisma.user.create({
        data: { id, name: id, urlId: id, uploadToken: id },
      })
    }
    authentication.userId = 'folder-owner'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function request(path = '/api/folders', method = 'GET', data?: unknown) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
  }

  async function newFolder(name: string, parentId: string | null = null) {
    const response = await folders.POST(
      request('/api/folders', 'POST', { name, parentId })
    )
    expect(response.status).toBe(200)
    return (await response.json())
      .data as import('@/lib/folders/schema').FolderView
  }

  async function file(
    input: {
      userId?: string
      folderId?: string
      visibility?: 'PUBLIC' | 'PRIVATE'
      password?: string
      name?: string
      urlPath?: string
    } = {}
  ) {
    return prisma.file.create({
      data: {
        userId: 'folder-owner',
        name: 'Photo.png',
        urlPath: `/${randomUUID()}`,
        path: 'unchanged-storage-path',
        mimeType: 'image/png',
        size: 100,
        ...input,
      },
    })
  }

  it('enforces normalized sibling names including root folders, while allowing separate parents and owners', async () => {
    const photos = await newFolder('  Ｐhotos  ')
    expect(photos).toMatchObject({
      name: 'Photos',
      parentId: null,
      shareToken: null,
      fileCount: 0,
    })
    expect(
      (await folders.POST(request('/api/folders', 'POST', { name: 'pHOTOS' })))
        .status
    ).toBe(409)
    await newFolder('Week 1', photos.id)
    expect(
      (
        await folders.POST(
          request('/api/folders', 'POST', {
            name: 'WEEK 1',
            parentId: photos.id,
          })
        )
      ).status
    ).toBe(409)
    await newFolder('Week 1')
    authentication.userId = 'folder-other'
    expect((await (await folders.GET(request())).json()).data).toEqual([])
    await newFolder('Photos')
  })

  it('rejects cross-owner nesting, edits, deletion and mixed-file moves even for admins', async () => {
    const own = await newFolder('Own')
    const ownFile = await file()
    const foreignFile = await file({ userId: 'folder-other' })
    expect(
      (
        await bulk.POST(
          request('/api/files/folders', 'POST', {
            fileIds: [ownFile.id, foreignFile.id],
            folderId: own.id,
          })
        )
      ).status
    ).toBe(404)
    expect(
      await prisma.file.count({ where: { folderId: { not: null } } })
    ).toBe(0)
    authentication.userId = 'folder-other'
    const context = { params: Promise.resolve({ id: own.id }) }
    expect(
      (
        await folders.POST(
          request('/api/folders', 'POST', { name: 'Child', parentId: own.id })
        )
      ).status
    ).toBe(404)
    expect(
      (
        await folder.PATCH(
          request(`/api/folders/${own.id}`, 'PATCH', {
            name: 'Hijacked',
            sharing: true,
          }),
          context
        )
      ).status
    ).toBe(404)
    expect(
      (
        await folder.DELETE(
          request(`/api/folders/${own.id}`, 'DELETE'),
          context
        )
      ).status
    ).toBe(404)
    expect(
      (
        await bulk.POST(
          request('/api/files/folders', 'POST', {
            fileIds: [foreignFile.id],
            folderId: own.id,
          })
        )
      ).status
    ).toBe(404)
    expect(
      await prisma.vaultFolder.findUniqueOrThrow({ where: { id: own.id } })
    ).toMatchObject({ name: 'Own', shareToken: null })
  })

  it('preserves stored URLs, paths, privacy and tags through a move and return to unfiled', async () => {
    const photos = await newFolder('Photos')
    const ownFile = await file({
      visibility: 'PRIVATE',
      password: 'existing-hash',
    })
    const tag = await prisma.vaultTag.create({
      data: {
        userId: 'folder-owner',
        name: 'Favorite',
        normalizedName: 'favorite',
      },
    })
    await prisma.vaultFileTag.create({
      data: { fileId: ownFile.id, tagId: tag.id },
    })
    for (const folderId of [photos.id, null]) {
      await service.moveFilesToFolder('folder-owner', {
        fileIds: [ownFile.id, ownFile.id],
        folderId,
      })
      const moved = await prisma.file.findUniqueOrThrow({
        where: { id: ownFile.id },
        include: { tags: true },
      })
      expect(moved).toMatchObject({
        ...ownFile,
        folderId,
        tags: [{ tagId: tag.id, excluded: false }],
      })
    }
  })

  it('dissolves a folder to its parent and allows a same-name child to take its place', async () => {
    const parent = await newFolder('Photos')
    const deleted = await newFolder('Week 1', parent.id)
    const child = await newFolder('Week 1', deleted.id)
    const direct = await file({ folderId: deleted.id })
    const nested = await file({ folderId: child.id })
    await service.deleteFolder('folder-owner', deleted.id)
    expect(
      await prisma.vaultFolder.findUnique({ where: { id: deleted.id } })
    ).toBeNull()
    expect(
      await prisma.vaultFolder.findUniqueOrThrow({ where: { id: child.id } })
    ).toMatchObject({ name: 'Week 1', parentId: parent.id })
    expect(
      await prisma.file.findUniqueOrThrow({ where: { id: direct.id } })
    ).toMatchObject({ ...direct, folderId: parent.id })
    expect(
      await prisma.file.findUniqueOrThrow({ where: { id: nested.id } })
    ).toEqual(nested)
    await service.deleteFolder('folder-owner', parent.id)
    expect(
      await prisma.file.findUniqueOrThrow({ where: { id: direct.id } })
    ).toMatchObject({ folderId: null })
    expect(
      await prisma.vaultFolder.findUniqueOrThrow({ where: { id: child.id } })
    ).toMatchObject({ parentId: null })
  })

  it('rolls back dissolution when a child would collide with an existing sibling', async () => {
    const deleted = await newFolder('Photos')
    const child = await newFolder('Week 1', deleted.id)
    await newFolder('Week 1')
    const ownFile = await file({ folderId: deleted.id })
    await expect(
      service.deleteFolder('folder-owner', deleted.id)
    ).rejects.toMatchObject({ status: 409 })
    expect(
      await prisma.vaultFolder.findUniqueOrThrow({ where: { id: child.id } })
    ).toMatchObject({ parentId: deleted.id })
    expect(
      await prisma.vaultFolder.findUniqueOrThrow({ where: { id: deleted.id } })
    ).toMatchObject({ name: 'Photos', normalizedName: 'photos' })
    expect(
      await prisma.file.findUniqueOrThrow({ where: { id: ownFile.id } })
    ).toEqual(ownFile)
  })

  it('serializes concurrent create and destination-delete races without dangling membership', async () => {
    const results = await Promise.allSettled([
      service.createFolder('folder-owner', { name: 'Photos', parentId: null }),
      service.createFolder('folder-owner', { name: 'Photos', parentId: null }),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(await prisma.vaultFolder.count()).toBe(1)
    const destination = await prisma.vaultFolder.findFirstOrThrow()
    const ownFile = await file()
    await Promise.allSettled([
      service.moveFilesToFolder('folder-owner', {
        fileIds: [ownFile.id],
        folderId: destination.id,
      }),
      service.deleteFolder('folder-owner', destination.id),
    ])
    expect(await prisma.vaultFolder.count()).toBe(0)
    expect(
      await prisma.file.findUniqueOrThrow({ where: { id: ownFile.id } })
    ).toEqual(ownFile)
  })

  it('keeps all-files default and ANDs direct folder membership with tags for lists and galleries', async () => {
    const photos = await newFolder('Photos')
    const child = await newFolder('Week 1', photos.id)
    const first = await file({ folderId: photos.id })
    const second = await file({ folderId: photos.id })
    await file({ folderId: child.id })
    await file()
    await file({ userId: 'folder-other' })
    const tag = await prisma.vaultTag.create({
      data: {
        userId: 'folder-owner',
        name: 'Favorite',
        normalizedName: 'favorite',
      },
    })
    await prisma.vaultFileTag.createMany({
      data: [first, second].map((entry) => ({
        fileId: entry.id,
        tagId: tag.id,
      })),
    })
    const all = await (await files.GET(request('/api/files'))).json()
    expect(all.pagination.total).toBe(4)
    const unfiled = await (
      await files.GET(request('/api/files?folder=unfiled'))
    ).json()
    expect(unfiled.pagination.total).toBe(1)
    const path = `/api/files?folder=${photos.id}&tag=${tag.id}&sortBy=oldest`
    const list = await (await files.GET(request(path))).json()
    expect(list.data.map((entry: { id: string }) => entry.id)).toEqual([
      first.id,
      second.id,
    ])
    const gallery = await (
      await files.GET(
        request(`${path}&galleryAnchor=${first.id}&galleryDirection=next`)
      )
    ).json()
    expect(gallery.data.map((entry: { id: string }) => entry.id)).toEqual([
      second.id,
    ])
    authentication.userId = 'folder-other'
    expect(
      (await (await files.GET(request(path))).json()).pagination.total
    ).toBe(0)
    expect(
      (
        await files.GET(
          request(`${path}&galleryAnchor=${first.id}&galleryDirection=next`)
        )
      ).status
    ).toBe(404)
  })

  it('shares only direct public files, keeps protected metadata hidden, and revokes old tokens', async () => {
    const photos = await newFolder('Photos')
    const child = await newFolder('Hidden child', photos.id)
    const publicFile = await file({ folderId: photos.id, name: 'Logo.png' })
    await file({
      folderId: photos.id,
      visibility: 'PRIVATE',
      name: 'Private plans.png',
    })
    const protectedFile = await file({
      folderId: photos.id,
      password: 'never-expose-this-hash',
      name: 'Protected secret.png',
      urlPath: '/folder-owner/Protected-secret.png',
    })
    await file({ folderId: child.id, name: 'Nested.png' })
    const enabled = await service.updateFolder('folder-owner', photos.id, {
      sharing: true,
    })
    const result = await shared.getSharedFolder(enabled.shareToken!)
    expect(result).toMatchObject({ name: 'Photos', total: 2 })
    expect(result!.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: publicFile.id,
          name: 'Logo.png',
          hasPassword: false,
        }),
        expect.objectContaining({
          name: 'Password-protected file',
          urlPath: `/s/folders/${enabled.shareToken}/files/${protectedFile.id}`,
          mimeType: null,
          size: null,
          hasPassword: true,
        }),
      ])
    )
    const serialized = JSON.stringify(result)
    for (const secret of [
      'Private plans',
      'Protected secret',
      'Protected-secret',
      'never-expose-this-hash',
      'Hidden child',
      'Nested.png',
      'userId',
      'folder-owner',
      'storage-path',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    await service.updateFolder('folder-owner', photos.id, { sharing: false })
    expect(await shared.getSharedFolder(enabled.shareToken!)).toBeNull()
    const reenabled = await service.updateFolder('folder-owner', photos.id, {
      sharing: true,
    })
    expect(reenabled.shareToken).not.toBe(enabled.shareToken)
    expect(await shared.getSharedFolder(enabled.shareToken!)).toBeNull()
  })

  it('allows account deletion with nested duplicate names without violating root uniqueness', async () => {
    const root = await newFolder('Photos')
    const child = await newFolder('Photos', root.id)
    await file({ folderId: child.id })
    await prisma.user.delete({ where: { id: 'folder-owner' } })
    expect(await prisma.vaultFolder.count()).toBe(0)
    expect(await prisma.file.count()).toBe(0)
  })

  it('migrates alongside retired Folder tables and File.folderId without changing legacy data', async () => {
    const schema = `flare_folders_test_legacy_${randomUUID().replaceAll('-', '')}`
    const migration = await readFile(
      'prisma/migrations/20260924010000_vault_folders/migration.sql',
      'utf8'
    )
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
        await tx.$executeRawUnsafe('CREATE TABLE "User" (id TEXT PRIMARY KEY)')
        await tx.$executeRawUnsafe(
          'CREATE TABLE "Folder" (id TEXT PRIMARY KEY)'
        )
        await tx.$executeRawUnsafe(
          'CREATE TABLE "File" (id TEXT PRIMARY KEY, "userId" TEXT, "folderId" TEXT CONSTRAINT "File_folderId_fkey" REFERENCES "Folder"(id))'
        )
        await tx.$executeRawUnsafe(
          'CREATE INDEX "File_userId_folderId_idx" ON "File"("userId", "folderId")'
        )
        await tx.$executeRawUnsafe('INSERT INTO "User" VALUES (\'owner\')')
        await tx.$executeRawUnsafe(
          'INSERT INTO "Folder" VALUES (\'legacy-folder\')'
        )
        await tx.$executeRawUnsafe(
          "INSERT INTO \"File\" VALUES ('file', 'owner', 'legacy-folder')"
        )
        for (const statement of migration
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)) {
          await tx.$executeRawUnsafe(statement)
        }
        expect(
          await tx.$queryRawUnsafe(
            'SELECT "folderId", "vaultFolderId" FROM "File"'
          )
        ).toEqual([{ folderId: 'legacy-folder', vaultFolderId: null }])
        await tx.$executeRawUnsafe(
          "INSERT INTO \"VaultFolder\" (id, \"userId\", name, \"normalizedName\") VALUES ('new-folder', 'owner', 'New', 'new')"
        )
        await tx.$executeRawUnsafe(
          'UPDATE "File" SET "vaultFolderId" = \'new-folder\''
        )
        expect(
          await tx.$queryRawUnsafe(
            'SELECT "folderId", "vaultFolderId" FROM "File"'
          )
        ).toEqual([{ folderId: 'legacy-folder', vaultFolderId: 'new-folder' }])
      })
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
  })
})
