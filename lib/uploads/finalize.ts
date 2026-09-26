import { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { validateOwnedFolderId } from '@/lib/folders/service'
import { enqueueFileReady } from '@/lib/integrations/webhooks'
import { loggers } from '@/lib/logger'
import { ocrQueue } from '@/lib/ocr'
import { hasPermission } from '@/lib/permissions/catalog'
import { getUserAccess, lockRoleChanges } from '@/lib/permissions/server'
import { validateFileType } from '@/lib/security/file-validation'
import type { StorageProvider } from '@/lib/storage'
import { captureStorageTarget } from '@/lib/storage/targets'
import { applyAutomaticTags, applyProfileTags } from '@/lib/tags/service'

import { UploadError } from './options'
import type { ResolvedUploadOptions } from './schema'

export async function prepareUploadDestination(
  user: AuthenticatedUser,
  filename: string,
  options: ResolvedUploadOptions
) {
  const { urlSafeName, displayName } = await getUniqueFilename(
    `uploads/${user.urlId}`,
    filename,
    options.randomizeFileUrls
  )
  if (!urlSafeName || urlSafeName.includes('/') || urlSafeName.includes('\\'))
    throw new UploadError('Invalid filename.')
  // Independent object keys prevent simultaneous same-name uploads overwriting bytes.
  return {
    filePath: `uploads/${user.urlId}/${randomUUID()}/${urlSafeName}`,
    urlPath: `/${user.urlId}/${urlSafeName}`,
    displayName,
    urlSafeName,
  }
}

export async function finalizeUpload(input: {
  user: AuthenticatedUser
  storage: StorageProvider
  filePath: string
  urlPath: string
  displayName: string
  mimeType: string
  size: number
  options: ResolvedUploadOptions
  passwordHash?: string | null
  isPaste?: boolean
  /** Chunk assembly already holds an upload lock on this transaction. */
  transaction?: Prisma.TransactionClient
}) {
  const { user, storage, filePath, displayName, mimeType, size, options } =
    input
  const storageTarget = captureStorageTarget(storage)
  if (!Number.isSafeInteger(size) || size < 0)
    throw new UploadError('Invalid file size.')
  const head = await storage.getFileStream(filePath, { start: 0, end: 4099 })
  const chunks: Buffer[] = []
  for await (const chunk of head) chunks.push(Buffer.from(chunk))
  const type = await validateFileType(Buffer.concat(chunks), mimeType)
  if (!type.valid)
    throw new UploadError(
      `File type mismatch: detected ${type.detectedType}, claimed ${mimeType}`
    )
  const passwordHash =
    input.passwordHash !== undefined
      ? input.passwordHash
      : options.password
        ? await hash(options.password, 10)
        : null
  const persist = async (tx: Prisma.TransactionClient) => {
    // Same order as settings/account policy updates: policy lock, then user lock.
    await lockRoleChanges(tx)
    const configRow = await tx.config.findUnique({
      where: { key: 'flare_config' },
    })
    const config = configRow
      ? configSchema.parse(configRow.value)
      : DEFAULT_CONFIG
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
    const fresh = await tx.user.findUnique({ where: { id: user.id } })
    if (!fresh) throw new UploadError('Account no longer exists.', 401)
    const access = await getUserAccess(user.id, tx)
    if (
      !hasPermission(access, 'files.upload') ||
      (input.isPaste && !hasPermission(access, 'pastes.create'))
    )
      throw new UploadError('Your role no longer allows this upload.', 403)
    if (options.folderId && !hasPermission(access, 'folders.manage'))
      throw new UploadError(
        'Your role cannot organize uploads into folders.',
        403
      )
    if (options.tagIds?.length && !hasPermission(access, 'tags.manage'))
      throw new UploadError('Your role cannot apply tags.', 403)
    if (
      options.expiresAt &&
      !hasPermission(
        access,
        options.expiryAction === 'DELETE' ? 'files.delete' : 'files.share'
      )
    )
      throw new UploadError(
        'Your role does not allow the selected expiration action. Disable expiration or ask for the required permission.',
        403
      )
    const existing = await tx.file.findFirst({
      where: { userId: user.id, path: filePath },
    })
    if (existing) return { file: existing, created: false }
    // Folder mutations take the same user lock, keeping this ownership check
    // and file publication atomic with folder removal.
    const folderId = await validateOwnedFolderId(
      user.id,
      options.folderId ?? null,
      tx
    )
    if (user.apiToken) {
      const token = await tx.apiToken.findUnique({
        where: { id: user.apiToken.id },
      })
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt && token.expiresAt <= new Date())
      )
        throw new UploadError('Upload token has expired or been revoked.', 403)
      if (token.userId !== user.id || !token.scopes.includes('files:upload'))
        throw new UploadError('This token cannot upload files.', 403)
      if (token.profileId && options.profileId !== token.profileId)
        throw new UploadError(
          'This token is restricted to its upload profile.',
          403
        )
      if (
        token.profileId &&
        !(await tx.uploadProfile.findFirst({
          where: { id: token.profileId, userId: user.id },
        }))
      )
        throw new UploadError('The token upload profile was removed.', 403)
    }
    const storageConfig = config.settings.general.storage
    const maxBytes =
      storageConfig.maxUploadSize.value *
      (storageConfig.maxUploadSize.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
    if (size > maxBytes)
      throw new UploadError(
        'The file exceeds the current upload size limit.',
        413
      )
    const sizeMB = size / 1024 ** 2
    const quota =
      storageConfig.quotas.default.value *
      (storageConfig.quotas.default.unit === 'GB' ? 1024 : 1)
    if (
      storageConfig.quotas.enabled &&
      !hasPermission(access, 'quotas.bypass') &&
      fresh.storageUsed + sizeMB > quota
    )
      throw new UploadError('The file would exceed your storage quota.', 413)
    if (options.expiresAt && new Date(options.expiresAt) <= new Date())
      throw new UploadError(
        'The selected expiration passed before upload finished.'
      )
    // An upload may have started before an administrator changed the URL ID.
    // Publish it under the locked user's current ID, keeping its object key stable.
    const name = basename(input.urlPath)
    let urlPath = `/${fresh.urlId}/${name}`
    if (await tx.file.findUnique({ where: { urlPath } })) {
      const extension = extname(name)
      urlPath = `/${fresh.urlId}/${name.slice(0, name.length - extension.length)}-${randomUUID().slice(0, 12)}${extension}`
    }
    const {
      password: _password,
      folderId: _folderId,
      ...persistedOptions
    } = options
    const file = await tx.file.create({
      data: {
        name: displayName,
        urlPath,
        path: filePath,
        storageTarget,
        mimeType,
        size: sizeMB,
        visibility: hasPermission(access, 'files.share')
          ? options.visibility
          : 'PRIVATE',
        isPaste: input.isPaste ?? false,
        password: passwordHash,
        userId: user.id,
        folderId,
        uploadOptions: persistedOptions as Prisma.InputJsonValue,
      },
    })
    await applyProfileTags(tx, file, options.tagIds ?? [])
    await applyAutomaticTags(file.id, 'filename', tx)
    await tx.user.update({
      where: { id: user.id },
      data: { storageUsed: { increment: sizeMB } },
    })
    if (options.expiresAt)
      await tx.event.create({
        data: {
          type: 'file.schedule-expiration',
          status: 'SCHEDULED',
          scheduledAt: new Date(options.expiresAt),
          payload: {
            fileId: file.id,
            userId: user.id,
            fileName: file.name,
            expiresAt: options.expiresAt,
            action: options.expiryAction,
          },
        },
      })
    await enqueueFileReady(tx, file)
    return { file, created: true }
  }
  const result = input.transaction
    ? await persist(input.transaction)
    : await prisma.$transaction(persist)
  if (result.created && !input.transaction) enqueueUploadProcessing(result.file)
  return result.file
}

/** Call only after the transaction that publishes this file has committed. */
export function enqueueUploadProcessing(file: {
  id: string
  path: string
  mimeType: string
}) {
  if (file.mimeType.startsWith('image/')) {
    void ocrQueue
      .add({ filePath: file.path, fileId: file.id })
      .catch((error) =>
        loggers.files.error('Background OCR failed', error as Error)
      )
  }
}

/** Never remove a committed object because response serialization or cleanup failed. */
export async function cleanupUncommittedUpload(
  storage: StorageProvider,
  filePath: string
) {
  if (!filePath) return
  try {
    if (
      await prisma.file.findFirst({
        where: { path: filePath },
        select: { id: true },
      })
    )
      return
    await storage.deleteFile(filePath)
  } catch (error) {
    loggers.files.warn('Could not clean up an uncommitted upload', {
      filePath,
      error,
    })
  }
}
