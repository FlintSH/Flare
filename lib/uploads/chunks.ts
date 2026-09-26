import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG, configSchema, getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { hasPermission } from '@/lib/permissions/catalog'
import { safeJoin, validatePathSegment } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'

import {
  cleanupUncommittedUpload,
  enqueueUploadProcessing,
  finalizeUpload,
  prepareUploadDestination,
} from './finalize'
import { uploadLinks } from './links'
import {
  UploadError,
  applyUploadOverrides,
  requestUploadOptions,
  resolveUploadOptions,
} from './options'
import {
  type ResolvedUploadOptions,
  discardLegacyCopyFormat,
  uploadRequestOptionsSchema,
} from './schema'

const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
const cleanupTimer = setInterval(async () => {
  try {
    for (const name of await readdir(TEMP_DIR)) {
      if (!/^meta-[a-z0-9]+$/.test(name)) continue
      try {
        const path = safeJoin(TEMP_DIR, name)
        const metadata = JSON.parse(
          await readFile(path, 'utf8')
        ) as UploadMetadata
        if (Date.now() - metadata.lastActivity > 3_600_000) await unlink(path)
      } catch {
        /* Another process may have removed the expired session. */
      }
    }
  } catch {
    /* The directory is created on the first chunk upload. */
  }
}, 3_600_000)
cleanupTimer.unref()
export interface UploadMetadata {
  fileKey: string
  filename: string
  mimeType: string
  totalSize: number
  userId: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  passwordHash?: string | null
  lastActivity: number
  urlPath: string
  s3UploadId: string
  options?: ResolvedUploadOptions
  storageFingerprint?: string
}

async function fingerprint(tx?: Prisma.TransactionClient) {
  const row = tx
    ? await tx.config.findUnique({ where: { key: 'flare_config' } })
    : null
  const config = tx
    ? row
      ? configSchema.parse(row.value)
      : DEFAULT_CONFIG
    : await getConfig()
  const { provider, s3 } = config.settings.general.storage
  return createHash('sha256')
    .update(JSON.stringify({ provider, s3 }))
    .digest('hex')
}

export async function getUploadMetadata(
  id: string
): Promise<UploadMetadata | null> {
  if (!/^[a-z0-9]{1,100}$/.test(id)) throw new UploadError('Invalid upload ID.')
  const path = safeJoin(TEMP_DIR, `meta-${validatePathSegment(id)}`)
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as UploadMetadata
    if (Date.now() - value.lastActivity > 3_600_000) {
      await unlink(path)
      return null
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function saveUploadMetadata(id: string, metadata: UploadMetadata) {
  if (!/^[a-z0-9]{1,100}$/.test(id)) throw new UploadError('Invalid upload ID.')
  const filename = `meta-${validatePathSegment(id)}`
  const path = safeJoin(TEMP_DIR, filename)
  const temporary = safeJoin(TEMP_DIR, `${filename}.${randomUUID()}.tmp`)
  await mkdir(TEMP_DIR, { recursive: true, mode: 0o700 })
  await writeFile(temporary, JSON.stringify(metadata), { mode: 0o600 })
  await rename(temporary, path)
}

export async function requireUploadMetadata(
  user: AuthenticatedUser,
  id: string,
  transaction?: Prisma.TransactionClient
) {
  const metadata = await getUploadMetadata(id)
  if (!metadata || metadata.userId !== user.id)
    throw new UploadError('Upload not found.', 404)
  if (
    user.apiToken?.profileId &&
    metadata.options?.profileId !== user.apiToken.profileId
  )
    throw new UploadError('This token cannot access this upload profile.', 403)
  if (
    metadata.storageFingerprint &&
    metadata.storageFingerprint !== (await fingerprint(transaction))
  )
    throw new UploadError(
      'Storage changed during this upload. Please start a new upload.',
      409
    )
  return metadata
}

const initSchema = uploadRequestOptionsSchema
  .innerType()
  .extend({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict()

export async function initializeChunkUpload(
  req: Request,
  user: AuthenticatedUser
) {
  const { filename, mimeType, size, ...bodyOptions } = initSchema.parse(
    discardLegacyCopyFormat(await req.json())
  )
  const selection = requestUploadOptions(req)
  if (
    selection.profileId !== undefined &&
    bodyOptions.profileId !== undefined &&
    selection.profileId !== bodyOptions.profileId
  )
    throw new UploadError('Conflicting profile selections.')
  if (
    selection.folderId !== undefined &&
    bodyOptions.folderId !== undefined &&
    selection.folderId !== bodyOptions.folderId
  )
    throw new UploadError('Conflicting upload folder selections.')
  const options = await resolveUploadOptions(user, {
    ...bodyOptions,
    ...selection,
  })
  const config = await getConfig()
  const storageConfig = config.settings.general.storage
  const maxBytes =
    storageConfig.maxUploadSize.value *
    (storageConfig.maxUploadSize.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
  if (size > maxBytes)
    throw new UploadError('The file exceeds the upload size limit.', 413)
  const quotaMB =
    storageConfig.quotas.default.value *
    (storageConfig.quotas.default.unit === 'GB' ? 1024 : 1)
  if (
    storageConfig.quotas.enabled &&
    !hasPermission(user, 'quotas.bypass') &&
    user.storageUsed + size / 1024 ** 2 > quotaMB
  )
    throw new UploadError('The file would exceed your storage quota.', 413)
  const destination = await prepareUploadDestination(user, filename, options)
  const storage = await getStorageProvider()
  const s3UploadId = await storage.initializeMultipartUpload(
    destination.filePath,
    mimeType
  )
  const uploadId = randomUUID().replace(/-/g, '')
  const passwordHash = options.password
    ? await hash(options.password, 10)
    : null
  await saveUploadMetadata(uploadId, {
    fileKey: destination.filePath,
    filename: destination.displayName,
    mimeType,
    totalSize: size,
    userId: user.id,
    visibility: options.visibility,
    password: null,
    passwordHash,
    lastActivity: Date.now(),
    urlPath: destination.urlPath,
    s3UploadId,
    options: { ...options, password: null },
    storageFingerprint: await fingerprint(),
  })
  return { uploadId, fileKey: destination.filePath }
}

const completeSchema = uploadRequestOptionsSchema
  .innerType()
  .extend({
    uploadId: z.string().optional(),
    parts: z
      .array(
        z
          .object({
            ETag: z.string().min(1).max(512),
            PartNumber: z.number().int().min(1).max(10000),
          })
          .strict()
      )
      .min(1)
      .max(10000),
  })
  .strict()

/** Serialize assembly across both completion routes and all application processes. */
export async function withUploadLock<T>(
  id: string,
  action: (transaction: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flare-upload:${id}`}, 0))`
      return action(tx)
    },
    { timeout: 120000, maxWait: 10000 }
  )
}

export async function completeChunkUpload(
  user: AuthenticatedUser,
  id: string,
  body: unknown
) {
  const {
    parts,
    uploadId: _uploadId,
    ...overrides
  } = completeSchema.parse(discardLegacyCopyFormat(body))
  if (new Set(parts.map((part) => part.PartNumber)).size !== parts.length)
    throw new UploadError('Duplicate upload part.')
  const metadata = await requireUploadMetadata(user, id)
  const initial =
    metadata.options ??
    (await resolveUploadOptions(user, {
      visibility: metadata.visibility,
      password: metadata.password,
    }))
  const options = applyUploadOverrides(user, initial, overrides)
  // Resolve the provider before entering the lock: its lazy initialization reads
  // configuration through the global client, which may have only one connection.
  const storage = await getStorageProvider()
  try {
    const result = await withUploadLock(id, async (transaction) => {
      await requireUploadMetadata(user, id, transaction)
      const existing = await transaction.file.findFirst({
        where: { userId: user.id, path: metadata.fileKey },
      })
      if (existing) return { file: existing, created: false }
      await storage.completeMultipartUpload(
        metadata.fileKey,
        metadata.s3UploadId,
        parts.sort((a, b) => a.PartNumber - b.PartNumber)
      )
      const size = await storage.getFileSize(metadata.fileKey)
      if (size !== metadata.totalSize)
        throw new UploadError(
          'Uploaded size does not match the declared file size.'
        )
      const file = await finalizeUpload({
        user,
        storage,
        transaction,
        filePath: metadata.fileKey,
        urlPath: metadata.urlPath,
        displayName: metadata.filename,
        mimeType: metadata.mimeType,
        size,
        options,
        passwordHash:
          overrides.password !== undefined ? undefined : metadata.passwordHash,
      })
      return { file, created: true }
    })
    if (result.created) enqueueUploadProcessing(result.file)
    // Retain the bounded session briefly so a lost completion response can retry.
    return uploadLinks(result.file, user)
  } catch (error) {
    const committed = await prisma.file.findFirst({
      where: { userId: user.id, path: metadata.fileKey },
    })
    if (committed) return uploadLinks(committed, user)
    await cleanupUncommittedUpload(storage, metadata.fileKey)
    throw error
  }
}
