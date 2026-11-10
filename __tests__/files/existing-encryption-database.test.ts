import type { FileEncryptionJob, PrismaClient } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  type FolderPrivateKey,
  base64urlEncode,
  decodeStoredRecord,
  decryptFile,
  folderPublicKeyOf,
  generateFolderPrivateKey,
  storedLengthOf,
  unwrapFolderFileStanza,
} from '@/lib/e2ee'
import { openSealedOcrText, openSealedThumbnail } from '@/lib/e2ee/client/files'
import { isWebp } from '@/lib/e2ee/client/thumbnails'
import type { StorageProvider } from '@/lib/storage'

import { clientKeys } from '../auth/e2ee-test-keys'
import {
  type TestKeys,
  createUser,
  storedKeys,
  unwrapperOf,
} from '../library/support'

/**
 * The server job that encrypts existing files (docs/e2ee-spec.md, section
 * 14.2), on PostgreSQL and a storage in memory. A file that the job made is
 * opened with the functions of the browser: the unwrap with the account
 * private key and the stream decryption.
 */

const databaseUrl = process.env.FLARE_EXISTING_FILES_DATABASE_URL

/** A storage that keeps objects in memory and can be told to fail. */
class MemoryStorage {
  readonly kind = 'local' as const
  readonly target = { provider: 'local' as const }
  readonly objects = new Map<string, Buffer>()
  failReads = 0
  /** A read that ends after half of the object, with no error. */
  shortReads = 0
  failWrites = 0
  corruptWrites = 0
  private get(path: string) {
    const bytes = this.objects.get(path)
    if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return bytes
  }
  async getFileStream(path: string) {
    const bytes = this.get(path)
    if (this.failReads > 0) {
      this.failReads--
      throw new Error(`cannot read ${path}`)
    }
    const pieces: Buffer[] = []
    const end =
      this.shortReads > 0 ? Math.floor(bytes.length / 2) : bytes.length
    if (this.shortReads > 0) this.shortReads--
    // Pieces that do not line up with the 65536-byte chunks.
    for (let at = 0; at < end; at += 50_000)
      pieces.push(Buffer.from(bytes.subarray(at, Math.min(end, at + 50_000))))
    return Readable.from(pieces, { objectMode: false })
  }
  async uploadStream(stream: Readable, path: string) {
    const pieces: Buffer[] = []
    for await (const piece of stream) pieces.push(Buffer.from(piece))
    if (this.failWrites > 0) {
      this.failWrites--
      throw new Error(`cannot write ${path}`)
    }
    const bytes = Buffer.concat(pieces)
    if (this.corruptWrites > 0) {
      this.corruptWrites--
      bytes[bytes.length - 1] ^= 1
    }
    this.objects.set(path, bytes)
    return { size: bytes.length }
  }
  async deleteFile(path: string) {
    this.objects.delete(path)
  }
  async getFileSize(path: string) {
    return this.get(path).length
  }
}

const state = vi.hoisted(() => ({
  storage: null as unknown,
  audits: [] as Record<string, unknown>[],
  session: null as null | { id: string },
}))
// The session of a route request. API credentials are refused before this.
vi.mock('@/lib/http/access', async (original) => {
  const actual = await original<typeof import('@/lib/http/access')>()
  const { AccessError } = await import('@/lib/http/errors')
  return {
    ...actual,
    requireSession: async (
      request: Request,
      _permission?: unknown,
      options: { refuseApiCredentials?: boolean } = {}
    ) => {
      if (options.refuseApiCredentials) actual.refuseApiCredentials(request)
      if (!state.session) throw new AccessError(401, 'Authentication required')
      return { session: { user: state.session }, user: state.session }
    },
  }
})
vi.mock('@/lib/database/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient({
      datasourceUrl:
        process.env.FLARE_EXISTING_FILES_DATABASE_URL ||
        'postgresql://unused@127.0.0.1/unused',
    }),
  }
})
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: { general: { ocr: { enabled: true } } },
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.storage,
}))
vi.mock('@/lib/audit', () => ({
  recordAudit: async (input: Record<string, unknown>) => {
    state.audits.push(input)
  },
  setAuditTarget: () => undefined,
  auditRequest: (_request: unknown, _settings: unknown, run: () => unknown) =>
    run(),
}))

vi.setConfig({ testTimeout: 60_000 })

function testDatabaseUrl(value: string) {
  const url = new URL(value)
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/flare_existing_files_test_(local|ci)$/.test(url.pathname)
  )
    throw new Error(
      'Use the disposable flare_existing_files_test_local or flare_existing_files_test_ci database'
    )
}

/** Records of a folder that has keys. The job reads only the public key. */
const sealedFolderRecords = {
  sealedFolderMetadata: new Uint8Array(60).fill(1),
  sealedFolderPrivateKey: new Uint8Array(89).fill(1),
}

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

describe.skipIf(!databaseUrl)(
  'the server encrypts existing files (PostgreSQL)',
  () => {
    let prisma: PrismaClient
    let job: typeof import('@/lib/files/existing-encryption')
    let manage: typeof import('@/lib/files/manage')
    let storage: MemoryStorage
    let keys: TestKeys
    let owner: string

    beforeAll(async () => {
      testDatabaseUrl(databaseUrl!)
      prisma = (await import('@/lib/database/prisma'))
        .prisma as unknown as PrismaClient
      job = await import('@/lib/files/existing-encryption')
      manage = await import('@/lib/files/manage')
    })
    beforeEach(async () => {
      await prisma.fileEncryptionJob.deleteMany()
      await prisma.storageDeletion.deleteMany()
      storage = new MemoryStorage()
      state.storage = storage
      state.audits.length = 0
      keys = clientKeys()
      owner = (await createUser(prisma, keys)).id
      state.session = { id: owner }
    })
    afterAll(async () => {
      await prisma?.$disconnect()
    })

    const provider = () => storage as unknown as StorageProvider

    async function plainFile(
      content: Uint8Array,
      data: Record<string, unknown> = {},
      userId = owner
    ) {
      const name = (data.name as string | undefined) ?? 'tax return 2025.pdf'
      const path = `uploads/${userId}/${randomUUID()}/${name.replaceAll(' ', '-')}`
      storage.objects.set(path, Buffer.from(content))
      const size = content.length / (1024 * 1024)
      const file = await prisma.file.create({
        data: {
          userId,
          name,
          urlPath: `/${userId}/${randomUUID()}-${name.replaceAll(' ', '-')}`,
          path,
          storageTarget: { provider: 'local' },
          mimeType: 'application/pdf',
          size,
          visibility: 'PRIVATE',
          ...data,
        },
      })
      await prisma.user.update({
        where: { id: userId },
        data: { storageUsed: { increment: size } },
      })
      return file
    }

    const queue = (
      selection: Parameters<typeof job.enqueueFileEncryption>[2] = {
        scope: 'all',
      },
      userId = owner
    ) => job.enqueueFileEncryption(prisma, userId, selection)

    async function claimOne() {
      const [claimed] = await job.claimFileEncryptions(1)
      expect(claimed).toBeDefined()
      return claimed
    }
    const attempt = (
      claimed: FileEncryptionJob,
      steps: import('@/lib/files/existing-encryption').FileEncryptionSteps = {}
    ) => job.processFileEncryption(claimed, { storage: provider(), steps })
    const runOne = async (
      steps: import('@/lib/files/existing-encryption').FileEncryptionSteps = {}
    ) => attempt(await claimOne(), steps)

    const row = (id: string) =>
      prisma.file.findUniqueOrThrow({
        where: { id },
        include: { sealedData: true },
      })
    const jobOf = (fileId: string) =>
      prisma.fileEncryptionJob.findUniqueOrThrow({ where: { fileId } })

    /** Opens an encrypted row as the browser of the owner does. */
    async function open(fileId: string, withKeys = keys, userId = owner) {
      const file = await row(fileId)
      expect(file.encrypted).toBe(true)
      const unwrapper = await unwrapperOf(storedKeys(userId, withKeys))
      const opened = await unwrapper.unwrap({
        header: base64urlEncode(file.header!),
        sealedMetadata: base64urlEncode(file.sealedMetadata!),
        accountStanza: base64urlEncode(file.accountStanza!),
        stanzaAccountPublicKey: base64urlEncode(file.stanzaAccountPublicKey!),
      })
      const pieces: Uint8Array[] = []
      const ciphertext = storage.objects.get(file.path)!
      for await (const piece of decryptFile(opened.fileKey, [ciphertext]))
        pieces.push(piece.slice())
      return { file, opened, content: Buffer.concat(pieces), ciphertext }
    }

    /** Runs the queued deletions as the storage worker does. */
    async function runQueuedDeletions() {
      const deletions = await prisma.storageDeletion.findMany()
      for (const deletion of deletions) storage.objects.delete(deletion.path)
      await prisma.storageDeletion.deleteMany()
      return deletions
    }

    /** The lease of every running job ran out, as after a process that stopped. */
    const expireLeases = () =>
      prisma.fileEncryptionJob.updateMany({
        where: { status: 'processing' },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      })

    for (const size of [0, 1, 65535, 65536, 65537, 3 * 1024 * 1024 + 17])
      it(`encrypts a file of ${size} bytes that the browser functions open`, async () => {
        const content = randomBytes(size)
        const before = await plainFile(content, {
          views: 7,
          downloads: 3,
          uploadedAt: new Date('2024-03-02T10:00:00Z'),
        })
        expect(await queue()).toBe(1)
        expect(await runOne()).toBe('encrypted')

        const {
          file,
          opened,
          content: decrypted,
          ciphertext,
        } = await open(before.id)
        expect(opened.name).toBe('tax return 2025.pdf')
        expect(opened.type).toBe('application/pdf')
        expect(decrypted.length).toBe(size)
        expect(sha256(decrypted)).toBe(sha256(content))
        expect(ciphertext.length).toBe(storedLengthOf(size))
        // The database has no name, no type and the encrypted address.
        expect(file.name).toBe('')
        expect(file.mimeType).toBe('application/octet-stream')
        expect(file.urlPath).toMatch(
          new RegExp(`^/${owner}/e_[A-Za-z0-9_-]{22}$`)
        )
        expect(file.path).not.toBe(before.path)
        expect(file.path).not.toContain('tax')
        expect(file.size).toBeCloseTo(storedLengthOf(size) / 1048576, 9)
        // What stays.
        expect(file.id).toBe(before.id)
        expect(file.views).toBe(7)
        expect(file.downloads).toBe(3)
        expect(file.uploadedAt).toEqual(before.uploadedAt)
        expect(file.visibility).toBe('PRIVATE')
        expect(file.thumbnailPending).toBe(true)
        // One object: the ciphertext. The plaintext is gone from storage.
        expect([...storage.objects.keys()]).toEqual([file.path])
        expect(await prisma.storageDeletion.count()).toBe(0)
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: owner },
        })
        expect(user.storageUsed).toBeCloseTo(file.size, 9)
        const done = await jobOf(before.id)
        expect(done).toMatchObject({
          status: 'done',
          result: 'encrypted',
          leaseId: null,
          ciphertextPath: null,
        })
        // The audit record names the file by its ID only.
        expect(state.audits).toEqual([
          expect.objectContaining({
            action: 'file.encrypted_by_server',
            targetId: before.id,
          }),
        ])
        expect(JSON.stringify(state.audits)).not.toContain('tax')
      })

    it('seals the image text and a thumbnail, and makes the folder stanza of a public file', async () => {
      const sharp = (await import('sharp')).default
      const image = await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 3,
          background: { r: 200, g: 40, b: 40 },
        },
      })
        .png()
        .toBuffer()
      const folderPrivateKey = generateFolderPrivateKey()
      const folderId = randomUUID()
      await prisma.vaultFolder.create({
        data: {
          id: folderId,
          userId: owner,
          name: '',
          normalizedName: `/sealed/${folderId}`,
          folderPublicKey: Uint8Array.from(folderPublicKeyOf(folderPrivateKey)),
          ...sealedFolderRecords,
        },
      })
      const tagId = randomUUID()
      const tag = await prisma.vaultTag.create({
        data: {
          id: tagId,
          userId: owner,
          name: '',
          normalizedName: `/sealed/${tagId}`,
          sealedTagMetadata: new Uint8Array(60).fill(1),
        },
      })
      const before = await plainFile(image, {
        name: 'whiteboard photo.png',
        mimeType: 'image/png',
        visibility: 'PUBLIC',
        folderId,
        ocrText: 'quarterly roadmap\nship the migration',
        ocrConfidence: 91,
        isOcrProcessed: true,
        tags: { create: { tagId: tag.id } },
      })
      await queue()
      expect(await runOne()).toBe('encrypted')

      const { file, opened, content } = await open(before.id)
      expect(opened.name).toBe('whiteboard photo.png')
      expect(opened.type).toBe('image/png')
      expect(sha256(content)).toBe(sha256(image))
      expect(file.ocrText).toBeNull()
      expect(file.ocrConfidence).toBeNull()
      expect(openSealedOcrText(opened, file.sealedData!.sealedOcrText!)).toBe(
        'quarterly roadmap\nship the migration'
      )
      const thumbnail = openSealedThumbnail(
        opened,
        file.sealedData!.sealedThumbnail!
      )
      expect(isWebp(thumbnail)).toBe(true)
      expect(thumbnail.length).toBeLessThanOrEqual(250_000)
      const shape = await sharp(thumbnail).metadata()
      expect([shape.width, shape.height]).toEqual([480, 270])
      expect(file.thumbnailPending).toBe(false)
      expect(file.ocrPending).toBe(false)
      // The account has a sealed tag, and no client applied its rule.
      expect(file.rulesPending).toBe(true)
      // The folder stanza opens with the folder private key.
      expect(file.visibility).toBe('PUBLIC')
      expect(file.folderId).toBe(folderId)
      const fileKey = unwrapFolderFileStanza({
        folderPrivateKey: folderPrivateKey as FolderPrivateKey,
        headerHash: opened.headerHash,
        stanza: decodeStoredRecord('folder_file_stanza', file.folderStanza!),
      })
      expect(Buffer.from(fileKey).equals(Buffer.from(opened.fileKey))).toBe(
        true
      )
      expect(
        await prisma.vaultFileTag.count({ where: { fileId: before.id } })
      ).toBe(1)
    })

    it('leaves an image without text for the browser to read', async () => {
      const before = await plainFile(randomBytes(300), {
        name: 'not really an image.png',
        mimeType: 'image/png',
      })
      await queue()
      expect(await runOne()).toBe('encrypted')
      const file = await row(before.id)
      expect(file.ocrPending).toBe(true)
      // sharp could not read these bytes: the browser makes the thumbnail.
      expect(file.thumbnailPending).toBe(true)
      expect(file.sealedData).toBeNull()
    })

    it('makes a file with a server-side password private until its owner decides', async () => {
      const before = await plainFile(randomBytes(100), {
        visibility: 'PUBLIC',
        password: 'a-password-hash',
      })
      // The default choice does not take it.
      expect(await queue({ scope: 'private' })).toBe(0)
      await queue({ scope: 'all' })
      expect(await runOne()).toBe('encrypted')
      const file = await row(before.id)
      expect(file).toMatchObject({
        encrypted: true,
        visibility: 'PRIVATE',
        password: null,
        passwordStanza: null,
        passwordPendingFrom: 'PUBLIC',
        folderStanza: null,
      })
      // The owner sets a password again: the mark goes away and the file
      // is shared as it was before.
      await manage.updateFileSettings(
        { as: 'owner', userId: owner },
        before.id,
        { passwordStanza: Buffer.alloc(217, 1).toString('base64url') }
      )
      const restored = await row(before.id)
      expect(restored).toMatchObject({
        passwordPendingFrom: null,
        visibility: 'PUBLIC',
      })
      expect(restored.passwordStanza).toHaveLength(217)
    })

    it('clears the mark of a pending password when the owner makes the file public', async () => {
      const before = await plainFile(randomBytes(100), {
        visibility: 'PUBLIC',
        password: 'a-password-hash',
      })
      await queue()
      await runOne()
      await prisma.file.update({
        where: { id: before.id },
        data: { visibility: 'PUBLIC' },
      })
      expect(await row(before.id)).toMatchObject({
        visibility: 'PUBLIC',
        passwordPendingFrom: null,
      })
    })

    it('takes only private files without a password for the choice "private"', async () => {
      const secret = await plainFile(randomBytes(10))
      const shared = await plainFile(randomBytes(10), { visibility: 'PUBLIC' })
      expect(await queue({ scope: 'private' })).toBe(1)
      expect(await runOne()).toBe('encrypted')
      expect((await row(secret.id)).encrypted).toBe(true)
      expect(await row(shared.id)).toMatchObject({
        encrypted: false,
        name: 'tax return 2025.pdf',
        urlPath: shared.urlPath,
      })
      expect(storage.objects.has(shared.path)).toBe(true)
      expect(await job.claimFileEncryptions()).toEqual([])
    })

    it('skips a file that its owner made public while a job for private files ran', async () => {
      const content = randomBytes(1000)
      const before = await plainFile(content)
      await queue({ scope: 'private' })
      const outcome = await runOne({
        afterVerify: () =>
          prisma.file.update({
            where: { id: before.id },
            data: { visibility: 'PUBLIC' },
          }),
      })
      expect(outcome).toBe('skipped')
      const file = await row(before.id)
      expect(file).toMatchObject({
        encrypted: false,
        path: before.path,
        urlPath: before.urlPath,
        name: before.name,
      })
      expect(storage.objects.get(before.path)!.equals(content)).toBe(true)
      // The ciphertext that was written is queued for deletion.
      const [deletion] = await runQueuedDeletions()
      expect(deletion.path).toMatch(/\/e_[A-Za-z0-9_-]{22}$/)
      expect([...storage.objects.keys()]).toEqual([before.path])
      expect(await jobOf(before.id)).toMatchObject({
        status: 'done',
        result: 'skipped',
        ciphertextPath: null,
      })
    })

    for (const step of [
      'afterJournal',
      'afterWrite',
      'afterVerify',
      'beforeCommit',
    ] as const)
      it(`keeps the plain file when the process stops at ${step}, and a later attempt finishes`, async () => {
        const content = randomBytes(200_000)
        const before = await plainFile(content)
        await queue()
        const first = await claimOne()
        await expect(
          attempt(first, {
            [step]: () => {
              throw new job.StoppedAttemptForTestsOnly()
            },
          })
        ).rejects.toBeInstanceOf(job.StoppedAttemptForTestsOnly)

        // The file is exactly the plain file it was.
        const untouched = await row(before.id)
        expect(untouched).toMatchObject({
          encrypted: false,
          name: before.name,
          path: before.path,
          urlPath: before.urlPath,
          header: null,
        })
        expect(storage.objects.get(before.path)!.equals(content)).toBe(true)
        const stopped = await jobOf(before.id)
        expect(stopped.status).toBe('processing')
        expect(stopped.ciphertextPath).toMatch(/\/e_/)
        // Nobody takes the job while its lease holds.
        expect(await job.claimFileEncryptions()).toEqual([])

        await expireLeases()
        const second = await claimOne()
        expect(second.attempts).toBe(2)
        // The object of the stopped attempt is queued, and not at once: a
        // slow writer may still hold it.
        const queued = await prisma.storageDeletion.findMany()
        expect(queued.map((deletion) => deletion.path)).toEqual([
          stopped.ciphertextPath,
        ])
        expect(queued[0].availableAt.getTime()).toBeGreaterThan(Date.now())
        expect(await attempt(second)).toBe('encrypted')

        const { file, content: decrypted } = await open(before.id)
        expect(sha256(decrypted)).toBe(sha256(content))
        await runQueuedDeletions()
        expect([...storage.objects.keys()]).toEqual([file.path])
      })

    it('finishes the deletion of the plaintext when the process stops after the switch', async () => {
      const content = randomBytes(70_000)
      const before = await plainFile(content)
      await queue()
      await expect(
        runOne({
          afterCommit: () => {
            throw new job.StoppedAttemptForTestsOnly()
          },
        })
      ).rejects.toBeInstanceOf(job.StoppedAttemptForTestsOnly)
      // The file is encrypted and readable, and the job is finished.
      const { file, content: decrypted } = await open(before.id)
      expect(sha256(decrypted)).toBe(sha256(content))
      expect(await jobOf(before.id)).toMatchObject({
        status: 'done',
        result: 'encrypted',
      })
      // The plaintext is still in storage, and its deletion is recorded.
      expect(storage.objects.has(before.path)).toBe(true)
      const deletions = await runQueuedDeletions()
      expect(deletions.map((deletion) => deletion.path)).toEqual([before.path])
      expect([...storage.objects.keys()]).toEqual([file.path])
      await expireLeases()
      expect(await job.claimFileEncryptions()).toEqual([])
    })

    it('ends as gone when the owner deletes the file during the job', async () => {
      const before = await plainFile(randomBytes(5000))
      await queue()
      const outcome = await runOne({
        afterVerify: () =>
          manage.deleteFile({ as: 'owner', userId: owner }, before.id),
      })
      expect(outcome).toBe('gone')
      expect(await prisma.file.findUnique({ where: { id: before.id } })).toBe(
        null
      )
      await runQueuedDeletions()
      expect(storage.objects.size).toBe(0)
      expect(await jobOf(before.id)).toMatchObject({
        status: 'done',
        result: 'gone',
      })
      const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
      expect(user.storageUsed).toBeCloseTo(0, 9)
    })

    it('removes the ciphertext when a deletion read the row before the switch', async () => {
      const before = await plainFile(randomBytes(5000))
      await queue()
      await runOne()
      const encrypted = await row(before.id)
      // What `deleteFile` does when its read of the row is older than the
      // switch: it deleted the old path and now deletes the row.
      const realFind = prisma.file.findUnique.bind(prisma.file)
      const spy = vi
        .spyOn(prisma.file, 'findUnique')
        .mockImplementationOnce((async (args: never) => ({
          ...(await realFind(args)),
          path: before.path,
          size: before.size,
        })) as never)
      await manage.deleteFile({ as: 'owner', userId: owner }, before.id)
      spy.mockRestore()
      const deletions = await runQueuedDeletions()
      expect(deletions.map((deletion) => deletion.path)).toEqual([
        encrypted.path,
      ])
      expect(storage.objects.size).toBe(0)
      const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
      expect(user.storageUsed).toBeCloseTo(0, 9)
    })

    it('seals the name and the password state that the row has at the switch', async () => {
      const before = await plainFile(randomBytes(500), { visibility: 'PUBLIC' })
      await queue()
      await runOne({
        afterWrite: () =>
          prisma.file.update({
            where: { id: before.id },
            data: { name: 'renamed during the job.pdf', password: 'new-hash' },
          }),
      })
      const { file, opened } = await open(before.id)
      expect(opened.name).toBe('renamed during the job.pdf')
      expect(file).toMatchObject({
        visibility: 'PRIVATE',
        password: null,
        passwordPendingFrom: 'PUBLIC',
      })
    })

    it('refuses a server password for a file that became encrypted', async () => {
      const before = await plainFile(randomBytes(500))
      await queue()
      await runOne()
      const realFind = prisma.file.findUnique.bind(prisma.file)
      const spy = vi
        .spyOn(prisma.file, 'findUnique')
        .mockImplementationOnce((async (args: never) => ({
          ...(await realFind(args)),
          encrypted: false,
        })) as never)
      await expect(
        manage.updateFileSettings({ as: 'owner', userId: owner }, before.id, {
          password: 'correct horse battery staple',
        })
      ).rejects.toMatchObject({ status: 409 })
      spy.mockRestore()
      expect((await row(before.id)).password).toBeNull()
    })

    it('lets one of two workers encrypt a file', async () => {
      const content = randomBytes(100_000)
      const before = await plainFile(content)
      await queue()
      const first = await claimOne()
      // A second worker gets nothing while the lease holds.
      expect(await job.claimFileEncryptions()).toEqual([])
      let second: Promise<unknown> | null = null
      const outcome = await attempt(first, {
        // The first worker is slow: its lease runs out and a second worker
        // takes the job and finishes it.
        afterVerify: async () => {
          await expireLeases()
          second = attempt(await claimOne())
          expect(await second).toBe('encrypted')
        },
      })
      expect(second).not.toBeNull()
      expect(outcome).toBe('lost')
      const { file, content: decrypted } = await open(before.id)
      expect(sha256(decrypted)).toBe(sha256(content))
      await runQueuedDeletions()
      // One object is left: the one that the row points at.
      expect([...storage.objects.keys()]).toEqual([file.path])
      expect(await jobOf(before.id)).toMatchObject({
        status: 'done',
        result: 'encrypted',
        attempts: 2,
      })
    })

    it('does not run two attempts from one claim', async () => {
      await plainFile(randomBytes(10))
      await queue()
      const claimed = await claimOne()
      expect(await attempt(claimed)).toBe('encrypted')
      // The same lease again: the job is finished.
      expect(await attempt(claimed)).toBe('lost')
      expect(storage.objects.size).toBe(1)
    })

    it('bounds the running jobs and gives each account a turn', async () => {
      const other = (await createUser(prisma, clientKeys())).id
      for (let index = 0; index < 4; index++) await plainFile(randomBytes(5))
      await plainFile(randomBytes(5), {}, other)
      await queue()
      await queue({ scope: 'all' }, other)
      const claimed = await job.claimFileEncryptions()
      expect(claimed).toHaveLength(job.FILE_ENCRYPTION_CONCURRENCY)
      expect(new Set(claimed.map((one) => one.userId))).toEqual(
        new Set([owner, other])
      )
      expect(await job.claimFileEncryptions()).toEqual([])
    })

    it('encrypts a stored file of an account that is at its quota', async () => {
      const content = randomBytes(2 * 1024 * 1024)
      const before = await plainFile(content)
      const used = (
        await prisma.user.findUniqueOrThrow({ where: { id: owner } })
      ).storageUsed
      await queue()
      expect(await runOne()).toBe('encrypted')
      const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
      const file = await row(before.id)
      // The ciphertext is 26 bytes and 32 bytes for each chunk larger.
      expect(file.size).toBeGreaterThan(before.size)
      expect(user.storageUsed - used).toBeCloseTo(file.size - before.size, 9)
      expect((file.size - before.size) * 1048576).toBeCloseTo(26 + 32 * 32, 3)
    })

    it('wraps for the account key of the switch when the key rotated during the job', async () => {
      const content = randomBytes(1234)
      const before = await plainFile(content)
      const rotated = clientKeys()
      await queue()
      await runOne({
        afterVerify: () =>
          prisma.user.update({
            where: { id: owner },
            data: rotated.columns,
          }),
      })
      const file = await row(before.id)
      expect(
        Buffer.from(file.stanzaAccountPublicKey!).equals(
          Buffer.from(rotated.accountKeys.accountPublicKey)
        )
      ).toBe(true)
      const { content: decrypted } = await open(before.id, rotated)
      expect(sha256(decrypted)).toBe(sha256(content))
      // The old key opens nothing.
      await expect(open(before.id, keys)).rejects.toThrow()
    })

    it('waits while a folder or a tag is not converted', async () => {
      const before = await plainFile(randomBytes(100))
      const folder = await prisma.vaultFolder.create({
        data: { userId: owner, name: 'Receipts', normalizedName: 'receipts' },
      })
      expect(await job.libraryReadyForEncryption(prisma, owner)).toBe(false)
      await queue()
      expect(await runOne()).toBe('postponed')
      expect(await row(before.id)).toMatchObject({
        encrypted: false,
        name: before.name,
      })
      expect(storage.objects.size).toBe(1)
      const waiting = await jobOf(before.id)
      expect(waiting).toMatchObject({
        status: 'pending',
        errorCode: 'library_not_ready',
        attempts: 0,
        ciphertextPath: null,
      })
      expect(waiting.availableAt.getTime()).toBeGreaterThan(Date.now())

      // The browser of the owner made the key pair.
      await prisma.vaultFolder.update({
        where: { id: folder.id },
        data: {
          name: '',
          normalizedName: `/sealed/${folder.id}`,
          folderPublicKey: Uint8Array.from(
            folderPublicKeyOf(generateFolderPrivateKey())
          ),
          ...sealedFolderRecords,
        },
      })
      await prisma.fileEncryptionJob.updateMany({
        data: { availableAt: new Date() },
      })
      expect(await runOne()).toBe('encrypted')
    })

    it('stops at the switch when a plain tag appeared during the job', async () => {
      const before = await plainFile(randomBytes(100))
      await queue()
      const outcome = await runOne({
        afterVerify: () =>
          prisma.vaultTag.create({
            data: { userId: owner, name: 'Later', normalizedName: 'later' },
          }),
      })
      expect(outcome).toBe('postponed')
      expect((await row(before.id)).encrypted).toBe(false)
      await runQueuedDeletions()
      expect([...storage.objects.keys()]).toEqual([before.path])
    })

    it('keeps the plain file when storage fails, and stops after three attempts', async () => {
      const content = randomBytes(4000)
      const before = await plainFile(content)
      await queue()
      storage.failWrites = 1
      expect(await runOne()).toBe('retry')
      expect(await jobOf(before.id)).toMatchObject({
        status: 'pending',
        errorCode: 'storage_write_failed',
        ciphertextPath: null,
      })
      const retryNow = () =>
        prisma.fileEncryptionJob.updateMany({
          data: { availableAt: new Date() },
        })
      await retryNow()
      // The stored object is not the ciphertext that was sent.
      storage.corruptWrites = 1
      expect(await runOne()).toBe('retry')
      expect((await jobOf(before.id)).errorCode).toBe('verification_failed')
      expect((await row(before.id)).encrypted).toBe(false)
      await retryNow()
      storage.failReads = 1
      expect(await runOne()).toBe('failed')
      expect(await jobOf(before.id)).toMatchObject({
        status: 'failed',
        errorCode: 'storage_read_failed',
        attempts: 3,
      })
      // Nothing was lost, and nothing that was written stays.
      await runQueuedDeletions()
      expect([...storage.objects.keys()]).toEqual([before.path])
      expect(storage.objects.get(before.path)!.equals(content)).toBe(true)
      expect(await job.claimFileEncryptions()).toEqual([])

      // The owner asks again.
      await queue({ fileIds: [before.id] })
      expect(await jobOf(before.id)).toMatchObject({
        status: 'pending',
        attempts: 0,
        errorCode: null,
      })
      expect(await runOne()).toBe('encrypted')
    })

    it('does not take a read that ended early for the file', async () => {
      const content = randomBytes(180_000)
      const before = await plainFile(content)
      await queue()
      // The storage ends the stream after half of the object, with no error.
      storage.shortReads = 1
      expect(await runOne()).toBe('retry')
      expect(await jobOf(before.id)).toMatchObject({
        status: 'pending',
        errorCode: 'storage_read_failed',
      })
      expect((await row(before.id)).encrypted).toBe(false)
      // The whole plaintext object stays, and the short ciphertext goes.
      await runQueuedDeletions()
      expect([...storage.objects.keys()]).toEqual([before.path])
      expect(storage.objects.get(before.path)!.equals(content)).toBe(true)
      // The next attempt reads the whole object and encrypts the file.
      await prisma.fileEncryptionJob.updateMany({
        data: { availableAt: new Date() },
      })
      expect(await runOne()).toBe('encrypted')
      expect((await row(before.id)).encrypted).toBe(true)
    })

    it('fails at once when the plaintext object is missing or the account has no keys', async () => {
      const lostFile = await plainFile(randomBytes(10))
      storage.objects.delete(lostFile.path)
      await queue()
      expect(await runOne()).toBe('failed')
      expect(await jobOf(lostFile.id)).toMatchObject({
        status: 'failed',
        errorCode: 'source_missing',
        attempts: 1,
      })

      const keyless = (await createUser(prisma, null)).id
      const theirs = await plainFile(randomBytes(10), {}, keyless)
      await queue({ scope: 'all' }, keyless)
      expect(await runOne()).toBe('failed')
      expect(await jobOf(theirs.id)).toMatchObject({
        status: 'failed',
        errorCode: 'account_keys_missing',
      })
      expect((await row(theirs.id)).encrypted).toBe(false)
    })

    it('removes the name from the records that the application wrote earlier', async () => {
      const before = await plainFile(randomBytes(10), {
        name: 'salary-negotiation.pdf',
      })
      const event = await prisma.event.create({
        data: {
          type: 'file.schedule-expiration',
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + 86_400_000),
          payload: {
            fileId: before.id,
            userId: owner,
            fileName: before.name,
            action: 'DELETE',
          },
        },
      })
      const audit = await prisma.auditEvent.create({
        data: {
          action: 'file.updated',
          category: 'files',
          outcome: 'success',
          targetType: 'file',
          targetId: before.id,
          targetName: before.name,
          details: {
            before: {
              name: before.name,
              mimeType: 'application/pdf',
              views: 1,
            },
            after: { name: before.name, mimeType: 'application/pdf', views: 2 },
          },
        },
      })
      await queue()
      await runOne()
      const payload = (
        await prisma.event.findUniqueOrThrow({ where: { id: event.id } })
      ).payload as Record<string, unknown>
      expect(payload).toEqual({
        fileId: before.id,
        userId: owner,
        action: 'DELETE',
      })
      const scrubbed = await prisma.auditEvent.findUniqueOrThrow({
        where: { id: audit.id },
      })
      expect(scrubbed.targetName).toBeNull()
      expect(scrubbed.details).toEqual({
        before: { views: 1 },
        after: { views: 2 },
      })
      const dump = JSON.stringify([
        await row(before.id),
        await jobOf(before.id),
        await prisma.event.findMany(),
        await prisma.auditEvent.findMany({ where: { targetId: before.id } }),
        await prisma.storageDeletion.findMany(),
        state.audits,
      ])
      expect(dump).not.toContain('salary')
    })

    it('reports the plain files by kind and the state of the jobs', async () => {
      const first = await plainFile(randomBytes(10))
      await plainFile(randomBytes(10), { visibility: 'PUBLIC' })
      await plainFile(randomBytes(10), {
        visibility: 'PUBLIC',
        password: 'hash',
      })
      expect(await job.existingFilesStatus(owner)).toMatchObject({
        hasKeys: true,
        choice: null,
        plain: { private: 1, public: 1, password: 1, total: 3 },
        libraryReady: true,
        jobs: { waiting: 0, running: 0, failed: 0, encrypted: 0 },
        failed: [],
        passwordPending: 0,
      })
      await queue()
      // Queued twice is queued once.
      await queue()
      expect((await job.existingFilesStatus(owner)).jobs.waiting).toBe(3)
      await runOne()
      await runOne()
      await runOne()
      const status = await job.existingFilesStatus(owner)
      expect(status).toMatchObject({
        plain: { total: 0 },
        jobs: { waiting: 0, encrypted: 3 },
        passwordPending: 1,
      })
      // A finished job of a file that is encrypted is not queued again.
      expect(await queue({ fileIds: [first.id] })).toBe(0)
      expect(await job.cancelWaitingFileEncryption(prisma, owner)).toBe(0)
      expect(
        await job.pruneFinishedFileEncryptions(
          new Date(Date.now() + job.FILE_ENCRYPTION_KEEP_DONE_MS + 1000)
        )
      ).toBe(3)
    })

    describe('the routes of the owner', () => {
      const call = async (
        method: 'GET' | 'PUT' | 'POST',
        path: '/api/files/existing' | '/api/files/existing/encrypt',
        body?: unknown,
        headers: Record<string, string> = {}
      ) => {
        const route =
          path === '/api/files/existing'
            ? await import('@/app/api/files/existing/route')
            : await import('@/app/api/files/existing/encrypt/route')
        const handler = (route as Record<string, unknown>)[method] as (
          request: Request,
          context: unknown
        ) => Promise<Response>
        const response = await handler(
          new Request(`http://localhost${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
          {}
        )
        return { status: response.status, body: await response.json() }
      }

      it('needs a session of the owner and takes no API credential', async () => {
        state.session = null
        expect((await call('GET', '/api/files/existing')).status).toBe(401)
        expect(
          (await call('PUT', '/api/files/existing', { choice: 'all' })).status
        ).toBe(401)
        expect(
          (
            await call('POST', '/api/files/existing/encrypt', {
              fileIds: ['a'],
            })
          ).status
        ).toBe(401)
        state.session = { id: owner }
        for (const [method, path, body] of [
          ['GET', '/api/files/existing', undefined],
          ['PUT', '/api/files/existing', { choice: 'all' }],
          ['POST', '/api/files/existing/encrypt', { fileIds: ['a'] }],
        ] as const)
          expect(
            (
              await call(method, path, body, {
                Authorization: 'Bearer flare_x',
              })
            ).status
          ).toBe(401)
        expect(await prisma.fileEncryptionJob.count()).toBe(0)
      })

      it('refuses bodies that are not exactly the schema', async () => {
        for (const body of [
          {},
          { choice: 'public' },
          { choice: 'all', userId: 'someone-else' },
          { choice: 'all', fileIds: ['a'] },
        ])
          expect((await call('PUT', '/api/files/existing', body)).status).toBe(
            400
          )
        for (const body of [
          {},
          { fileIds: [] },
          { fileIds: 'a' },
          { fileIds: [1] },
          { fileIds: ['a'], scope: 'all' },
          { fileIds: Array.from({ length: 501 }, (_, index) => `f${index}`) },
        ])
          expect(
            (await call('POST', '/api/files/existing/encrypt', body)).status
          ).toBe(400)
      })

      it('records the choice one time and queues the files it covers', async () => {
        const secret = await plainFile(randomBytes(10))
        const shared = await plainFile(randomBytes(10), {
          visibility: 'PUBLIC',
        })
        const first = await call('GET', '/api/files/existing')
        expect(first.body.data).toMatchObject({
          choice: null,
          plain: { private: 1, public: 1, password: 0, total: 2 },
        })
        const chosen = await call('PUT', '/api/files/existing', {
          choice: 'private',
        })
        expect(chosen.status).toBe(200)
        expect(chosen.body.data).toMatchObject({
          choice: 'private',
          jobs: { waiting: 1 },
        })
        expect(chosen.body.data.choiceAt).toEqual(expect.any(String))
        expect((await jobOf(secret.id)).onlyIfPrivate).toBe(true)
        // A wider answer later replaces the jobs that wait.
        const wider = await call('PUT', '/api/files/existing', {
          choice: 'all',
        })
        expect(wider.body.data.jobs.waiting).toBe(2)
        expect((await jobOf(shared.id)).onlyIfPrivate).toBe(false)
        // "none" takes back what did not start.
        const none = await call('PUT', '/api/files/existing', {
          choice: 'none',
        })
        expect(none.body.data).toMatchObject({
          choice: 'none',
          jobs: { waiting: 0 },
        })
        expect(await prisma.fileEncryptionJob.count()).toBe(0)
      })

      it('queues only plain files of the session account', async () => {
        const mine = await plainFile(randomBytes(10), { visibility: 'PUBLIC' })
        const stranger = (await createUser(prisma, clientKeys())).id
        const theirs = await plainFile(randomBytes(10), {}, stranger)
        const queued = await call('POST', '/api/files/existing/encrypt', {
          fileIds: [mine.id, theirs.id, 'no-such-file', mine.id],
        })
        expect(queued).toMatchObject({
          status: 200,
          body: { data: { queued: 1 } },
        })
        expect(
          (await prisma.fileEncryptionJob.findMany()).map((one) => one.fileId)
        ).toEqual([mine.id])
        expect(await runOne()).toBe('encrypted')
        expect((await row(theirs.id)).encrypted).toBe(false)
        // An administrator who names another account in the body is refused
        // by the schema, and a session only ever acts on its own account.
        state.session = { id: stranger }
        const other = await call('GET', '/api/files/existing')
        expect(other.body.data.plain.total).toBe(1)
        expect(other.body.data.jobs.encrypted).toBe(0)
      })

      it('refuses an account that has no keys', async () => {
        const keyless = (await createUser(prisma, null)).id
        await plainFile(randomBytes(10), {}, keyless)
        state.session = { id: keyless }
        const refused = await call('PUT', '/api/files/existing', {
          choice: 'private',
        })
        expect(refused.status).toBe(409)
        expect(refused.body.code ?? refused.body.error?.code).toBe(
          'account_keys_missing'
        )
        expect(await prisma.fileEncryptionJob.count()).toBe(0)
        const status = await call('GET', '/api/files/existing')
        expect(status.body.data).toMatchObject({ hasKeys: false, choice: null })
      })

      it('lists a failed file with its name while it is still plain', async () => {
        const broken = await plainFile(randomBytes(10), { name: 'gone.bin' })
        storage.objects.delete(broken.path)
        await call('PUT', '/api/files/existing', { choice: 'all' })
        expect(await runOne()).toBe('failed')
        const status = await call('GET', '/api/files/existing')
        expect(status.body.data.failed).toEqual([
          { fileId: broken.id, name: 'gone.bin', code: 'source_missing' },
        ])
        expect(status.body.data.jobs.failed).toBe(1)
      })
    })
  }
)
