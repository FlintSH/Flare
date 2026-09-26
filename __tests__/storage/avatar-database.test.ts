import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
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

import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const authentication = vi.hoisted(() => ({
  userId: '',
  permissions: [] as string[],
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: {
      id: authentication.userId,
      permissions: authentication.permissions,
    },
  }),
}))

const databaseUrl = process.env.FLARE_AVATAR_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
const memberId = `avatar-member-${randomUUID()}`
const adminId = `avatar-admin-${randomUUID()}`
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=',
  'base64'
)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

suite.sequential(
  'avatar publication and cleanup against isolated PostgreSQL',
  () => {
    let prisma: typeof import('@/lib/database/prisma').prisma
    let permissions: typeof import('@/lib/permissions/server')
    let cleanup: typeof import('@/lib/storage/deletion')
    let storage: typeof import('@/lib/storage')
    let configuration: typeof import('@/lib/config')
    let route: typeof import('@/app/api/profile/avatar/route')
    let serve: typeof import('@/app/api/avatars/[filename]/route')
    let remove: typeof import('@/app/api/users/[id]/avatar/route')
    const paths = new Set<string>()
    const s3 = mockClient(S3Client)

    beforeAll(async () => {
      const url = new URL(databaseUrl!)
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        !/^\/flare_avatar_test_/.test(url.pathname)
      )
        throw new Error('Use a disposable local flare_avatar_test_ database')
      vi.stubEnv('DATABASE_URL', url.toString())
      prisma = (await import('@/lib/database/prisma')).prisma
      permissions = await import('@/lib/permissions/server')
      cleanup = await import('@/lib/storage/deletion')
      storage = await import('@/lib/storage')
      configuration = await import('@/lib/config')
      route = await import('@/app/api/profile/avatar/route')
      serve = await import('@/app/api/avatars/[filename]/route')
      remove = await import('@/app/api/users/[id]/avatar/route')
    }, 120000)

    beforeEach(async () => {
      s3.reset()
      storage.invalidateStorageProvider()
      await prisma.storageDeletion.deleteMany()
      await prisma.user.deleteMany()
      await prisma.role.deleteMany()
      await prisma.config.deleteMany()
      await prisma.config.create({
        data: { key: 'flare_config', value: configuration.DEFAULT_CONFIG },
      })
      const roles = await prisma.$transaction(permissions.ensureBuiltInRoles)
      await prisma.user.create({
        data: {
          id: adminId,
          name: 'Administrator',
          email: 'admin@example.test',
          password: 'fixture',
          urlId: 'admin',
          uploadToken: 'admin-fixture',
          roles: { connect: { id: roles.administrator.id } },
        },
      })
      await prisma.user.create({
        data: {
          id: memberId,
          name: 'Member',
          email: 'member@example.test',
          password: 'fixture',
          urlId: 'member',
          uploadToken: 'member-fixture',
        },
      })
      authentication.userId = memberId
      authentication.permissions = [...DEFAULT_PERMISSIONS]
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      storage.invalidateStorageProvider()
      for (const path of paths) await rm(path, { force: true })
      paths.clear()
    })

    afterAll(async () => {
      s3.restore()
      await prisma?.$disconnect()
      vi.unstubAllEnvs()
    })

    function upload(bytes = image) {
      const form = new FormData()
      form.set(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        'avatar.png'
      )
      return route.POST(
        new Request('http://localhost/api/profile/avatar', {
          method: 'POST',
          body: form,
        })
      )
    }

    async function setS3(bucket: string) {
      const config = structuredClone(configuration.DEFAULT_CONFIG)
      config.settings.general.storage.provider = 's3'
      config.settings.general.storage.s3 = {
        bucket,
        region: 'us-east-1',
        endpoint: 'https://storage.example.test',
        forcePathStyle: true,
        accessKeyId: 'fixture-access',
        secretAccessKey: 'fixture-secret',
      }
      await prisma.config.update({
        where: { key: 'flare_config' },
        data: { value: config },
      })
      storage.invalidateStorageProvider()
    }

    async function existingAvatar() {
      const path = `uploads/avatars/${memberId}-previous.jpg`
      paths.add(path)
      await new storage.LocalStorageProvider().uploadFile(
        image,
        path,
        'image/jpeg'
      )
      await prisma.user.update({
        where: { id: memberId },
        data: {
          image: `/api/avatars/${memberId}-previous.jpg`,
          avatarStoragePath: path,
          avatarStorageTarget: { provider: 'local' },
        },
      })
      return path
    }

    function pauseUpload(when: 'before' | 'after' = 'before') {
      const started = deferred<string>()
      const release = deferred<void>()
      const original = storage.LocalStorageProvider.prototype.uploadFile
      vi.spyOn(
        storage.LocalStorageProvider.prototype,
        'uploadFile'
      ).mockImplementation(async function (
        this: InstanceType<typeof storage.LocalStorageProvider>,
        bytes,
        path,
        mime
      ) {
        paths.add(path)
        if (when === 'after') await original.call(this, bytes, path, mime)
        started.resolve(path)
        await release.promise
        if (when === 'before') await original.call(this, bytes, path, mime)
      })
      return { started, release }
    }

    async function drain() {
      const jobs = await cleanup.claimStorageDeletions()
      expect(
        await Promise.all(jobs.map(cleanup.processStorageDeletion))
      ).toEqual(jobs.map(() => true))
      return jobs
    }

    it.each(['before', 'after'] as const)(
      'deletion while paused %s the physical write cannot acknowledge its intent prematurely',
      async (when) => {
        const old = await existingAvatar()
        const paused = pauseUpload(when)
        const pending = upload()
        let written = ''
        try {
          written = await paused.started.promise
          const intent = await prisma.storageDeletion.findFirstOrThrow({
            where: { path: written },
          })
          expect(intent).toMatchObject({
            ownerId: memberId,
            writePending: true,
            target: { provider: 'local' },
          })
          await cleanup.deleteAccountWithStorageCleanup(
            adminId,
            memberId,
            'users.delete'
          )
          const jobs = await drain()
          expect(jobs.map((job) => job.path)).toEqual([old])
          expect(
            await prisma.storageDeletion.findUnique({
              where: { id: intent.id },
            })
          ).toMatchObject({ writePending: true })
          expect(await cleanup.claimStorageDeletions()).toEqual([])
        } finally {
          paused.release.resolve()
        }
        const response = await pending
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Account not found' })
        expect(await readFile(written)).toEqual(image)
        expect(
          await prisma.storageDeletion.findFirst({ where: { path: written } })
        ).toMatchObject({ writePending: false })
        expect((await drain()).map((job) => job.path)).toEqual([written])
        await expect(readFile(written)).rejects.toMatchObject({
          code: 'ENOENT',
        })
        expect(await prisma.storageDeletion.count()).toBe(0)
      }
    )

    it('revoked profile permission rejects publication, preserves the previous avatar and durably removes the new object', async () => {
      const old = await existingAvatar()
      const paused = pauseUpload()
      const pending = upload()
      let written = ''
      try {
        written = await paused.started.promise
        await prisma.$transaction(async (tx) => {
          await permissions.lockRoleChanges(tx)
          await tx.role.update({
            where: { systemKey: 'everyone' },
            data: { permissions: ['files.read'] },
          })
        })
      } finally {
        paused.release.resolve()
      }
      expect((await pending).status).toBe(403)
      expect(
        await prisma.user.findUnique({ where: { id: memberId } })
      ).toMatchObject({ avatarStoragePath: old })
      expect((await drain()).map((job) => job.path)).toEqual([written])
      expect(await readFile(old)).toEqual(image)
      await expect(readFile(written)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('concurrent replacements use different keys and only queue the avatar that was actually superseded', async () => {
      const first = deferred<void>(),
        second = deferred<void>()
      const started = deferred<void>()
      const written: string[] = []
      const original = storage.LocalStorageProvider.prototype.uploadFile
      vi.spyOn(
        storage.LocalStorageProvider.prototype,
        'uploadFile'
      ).mockImplementation(async function (
        this: InstanceType<typeof storage.LocalStorageProvider>,
        bytes,
        path,
        mime
      ) {
        const index = written.length
        written.push(path)
        paths.add(path)
        if (written.length === 2) started.resolve()
        await (index === 0 ? first.promise : second.promise)
        await original.call(this, bytes, path, mime)
      })
      const one = upload(Buffer.concat([image, Buffer.from('first')]))
      const two = upload(Buffer.concat([image, Buffer.from('second')]))
      try {
        await started.promise
        expect(new Set(written).size).toBe(2)
        second.resolve()
        // Resolve requests by completion instead of assuming preparation order.
        const winner = await Promise.race([one, two])
        expect(winner.status).toBe(200)
        expect(
          await prisma.user.findUnique({ where: { id: memberId } })
        ).toMatchObject({ avatarStoragePath: written[1] })
        first.resolve()
        expect(
          (await Promise.all([one, two])).map((response) => response.status)
        ).toEqual([200, 200])
        expect(
          await prisma.user.findUnique({ where: { id: memberId } })
        ).toMatchObject({ avatarStoragePath: written[0] })
        expect((await drain()).map((job) => job.path)).toEqual([written[1]])
        expect(await readFile(written[0])).toEqual(expect.any(Buffer))
        await expect(readFile(written[1])).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        first.resolve()
        second.resolve()
        await Promise.all([one, two])
      }
    })

    it('published local avatars remain readable after the instance switches to S3', async () => {
      const result = await upload()
      expect(result.status).toBe(200)
      const { url } = await result.json()
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: memberId },
      })
      paths.add(user.avatarStoragePath!)
      expect(user.avatarStorageTarget).toEqual({ provider: 'local' })
      await setS3('new-active-bucket')
      const response = await serve.GET(
        new Request(`http://localhost${url}`) as never,
        {
          params: Promise.resolve({ filename: url.split('/').pop() }),
        }
      )
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(image)
      await cleanup.deleteAccountWithStorageCleanup(
        adminId,
        memberId,
        'users.delete'
      )
      await drain()
      expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0)
      await expect(readFile(user.avatarStoragePath!)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })

    it('S3 avatars capture the real unique key, serve their original public URL, and refuse redirects to a different configured bucket', async () => {
      s3.on(PutObjectCommand).resolves({})
      s3.on(DeleteObjectCommand).resolves({})
      await setS3('avatar-original')
      const result = await upload()
      expect(result.status).toBe(200)
      const { url } = await result.json()
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: memberId },
      })
      const filename = user.avatarStoragePath!.split('/').pop()!
      expect(user.avatarStorageTarget).toMatchObject({
        provider: 's3',
        bucket: 'avatar-original',
      })
      expect(url).toBe(
        `https://storage.example.test/avatar-original/avatars/${filename}`
      )
      expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
        Bucket: 'avatar-original',
        Key: `avatars/${filename}`,
        ACL: 'public-read',
      })
      const get = () =>
        serve.GET(
          new Request(`http://localhost/api/avatars/${filename}`) as never,
          { params: Promise.resolve({ filename }) }
        )
      expect((await get()).headers.get('Location')).toBe(url)
      await setS3('different-active-bucket')
      expect((await get()).status).toBe(503)
      await cleanup.deleteAccountWithStorageCleanup(
        adminId,
        memberId,
        'users.delete'
      )
      const [job] = await cleanup.claimStorageDeletions()
      expect(await cleanup.processStorageDeletion(job)).toBe(false)
      expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0)
      await setS3('avatar-original')
      await prisma.storageDeletion.updateMany({
        data: { availableAt: new Date(0) },
      })
      await drain()
      expect(s3.commandCalls(DeleteObjectCommand)[0].args[0].input).toEqual({
        Bucket: 'avatar-original',
        Key: `avatars/${filename}`,
      })
    })

    it('failed physical writes keep durable cleanup work for partial objects', async () => {
      const original = storage.LocalStorageProvider.prototype.uploadFile
      vi.spyOn(
        storage.LocalStorageProvider.prototype,
        'uploadFile'
      ).mockImplementation(async function (
        this: InstanceType<typeof storage.LocalStorageProvider>,
        bytes,
        path,
        mime
      ) {
        paths.add(path)
        await original.call(this, bytes, path, mime)
        throw new Error('Simulated storage failure after a partial write')
      })
      expect((await upload()).status).toBe(500)
      const job = await prisma.storageDeletion.findFirstOrThrow()
      expect(job.writePending).toBe(false)
      expect(await readFile(job.path)).toEqual(image)
      expect(
        await prisma.user.findUnique({ where: { id: memberId } })
      ).toMatchObject({ image: null, avatarStoragePath: null })
      await drain()
      await expect(readFile(job.path)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('a failed intent release retains an unclaimable record instead of losing cleanup after storage failure', async () => {
      const original = storage.LocalStorageProvider.prototype.uploadFile
      vi.spyOn(
        storage.LocalStorageProvider.prototype,
        'uploadFile'
      ).mockImplementation(async function (
        this: InstanceType<typeof storage.LocalStorageProvider>,
        bytes,
        path,
        mime
      ) {
        paths.add(path)
        await original.call(this, bytes, path, mime)
        throw new Error('Storage failure')
      })
      vi.spyOn(prisma.storageDeletion, 'updateMany').mockRejectedValue(
        new Error('Database temporarily unavailable')
      )
      expect((await upload()).status).toBe(500)
      const job = await prisma.storageDeletion.findFirstOrThrow()
      expect(job.writePending).toBe(true)
      expect(await cleanup.claimStorageDeletions()).toEqual([])
      expect(await readFile(job.path)).toEqual(image)
    })

    it('a crashed writer stays pending across account deletion until explicitly reconciled after writers stop', async () => {
      const path = `uploads/avatars/${memberId}-crashed.jpg`
      paths.add(path)
      const intent = await prisma.storageDeletion.create({
        data: {
          ownerId: memberId,
          path,
          provider: 'local',
          target: { provider: 'local' },
          writePending: true,
          availableAt: new Date(0),
        },
      })
      // Simulate a process that persisted its intent and wrote bytes, then died
      // before publication. No upload promise remains active in this test.
      await new storage.LocalStorageProvider().uploadFile(
        image,
        path,
        'image/jpeg'
      )
      await cleanup.deleteAccountWithStorageCleanup(
        adminId,
        memberId,
        'users.delete'
      )
      expect(await cleanup.claimStorageDeletions()).toEqual([])
      expect(
        await prisma.storageDeletion.findUnique({ where: { id: intent.id } })
      ).toMatchObject({ writePending: true })
      await prisma.storageDeletion.update({
        where: { id: intent.id },
        data: { writePending: false },
      })
      await drain()
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('administrator avatar removal atomically queues the recorded object and clears its public reference and provenance', async () => {
      const path = await existingAvatar()
      authentication.userId = adminId
      authentication.permissions = ['administrator']
      const request = new Request(
        `http://localhost/api/users/${memberId}/avatar`,
        { method: 'DELETE', headers: { Origin: 'http://localhost' } }
      )
      const response = await remove.DELETE(request, {
        params: Promise.resolve({ id: memberId }),
      })
      expect(response.status).toBe(204)
      expect(
        await prisma.user.findUnique({ where: { id: memberId } })
      ).toMatchObject({
        image: null,
        avatarStoragePath: null,
        avatarStorageTarget: null,
      })
      expect(await readFile(path)).toEqual(image)
      const unavailable = await serve.GET(
        new Request(
          `http://localhost/api/avatars/${memberId}-previous.jpg`
        ) as never,
        { params: Promise.resolve({ filename: `${memberId}-previous.jpg` }) }
      )
      expect(unavailable.status).toBe(404)
      expect((await drain()).map((job) => job.path)).toEqual([path])
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('rejects text form fields before creating an upload intent', async () => {
      const form = new FormData()
      form.set('file', 'not an uploaded file')
      const response = await route.POST(
        new Request('http://localhost/api/profile/avatar', {
          method: 'POST',
          body: form,
        })
      )
      expect(response.status).toBe(400)
      expect(await prisma.storageDeletion.count()).toBe(0)
    })
  }
)
