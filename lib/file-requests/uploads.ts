import { randomUUID } from 'node:crypto'

import { recordAudit } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { FolderError } from '@/lib/folders/service'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'
import { captureStorageTarget } from '@/lib/storage/targets'
import { TagError } from '@/lib/tags/service'
import {
  type UploadMetadata,
  discardUploadSession,
  fingerprint,
  getUploadMetadata,
  getUploadStorage,
  saveUploadMetadata,
  withUploadLock,
} from '@/lib/uploads/chunks'
import { uploadDisplayName } from '@/lib/uploads/display-name'
import {
  type UploadDelivery,
  cleanupUncommittedUpload,
  enqueueUploadProcessing,
  finalizeUpload,
  prepareUploadDestination,
} from '@/lib/uploads/finalize'
import { UploadError, resolveUploadOptions } from '@/lib/uploads/options'
import type { ResolvedUploadOptions } from '@/lib/uploads/schema'

import { recordDelivery } from './notify'
import {
  MAX_ACTIVE_UPLOADS_PER_BATCH,
  MAX_ACTIVE_UPLOADS_PER_REQUEST,
  MAX_PARTS,
  MAX_PART_BYTES,
  UPLOAD_RESERVATION_IDLE_MS,
  fileRequestStatus,
  formatRequestBytes,
  requestPartSize,
  requestUploadInitSchema,
} from './policy'
import {
  FileRequestError,
  type FileRequestRecord,
  type OwnerContext,
  deliveryProblem,
  loadOwnerContext,
  maxUploadBytes,
  ownerUploader,
  remainingQuotaBytes,
  unavailable,
} from './service'
import {
  hashSubmissionKey,
  isFileRequestToken,
  isSubmissionKey,
} from './tokens'

const invalidSession = () =>
  new FileRequestError(
    'This upload session isn’t valid anymore. Reload the page and try again.',
    403,
    'invalid_session'
  )
const uploadNotFound = () =>
  new FileRequestError(
    'This upload stopped after a while without activity, or doesn’t exist. Send the file again.',
    404,
    'upload_not_found'
  )

async function findSubmission(token: unknown, key: unknown) {
  if (!isFileRequestToken(token)) throw unavailable('invalid')
  if (!isSubmissionKey(key)) throw invalidSession()
  const submission = await prisma.fileRequestSubmission.findUnique({
    where: { keyHash: hashSubmissionKey(key) },
    select: {
      id: true,
      requestId: true,
      completedAt: true,
      fileCount: true,
      bytes: true,
      request: {
        select: {
          token: true,
          userId: true,
          closedAt: true,
          expiresAt: true,
          maxFiles: true,
          fileCount: true,
          maxBytes: true,
          bytesReceived: true,
        },
      },
    },
  })
  // A replaced link revokes every session that started from the old one.
  if (!submission || submission.request.token !== token) throw invalidSession()
  return submission
}

/** The full set of checks before bytes are accepted for a new file. */
async function openSession(
  token: unknown,
  key: unknown,
  submissionId?: string
) {
  const submission = await findSubmission(token, key)
  if (submissionId !== undefined && submission.id !== submissionId)
    throw invalidSession()
  if (submission.completedAt)
    throw new FileRequestError(
      'These files were already sent. Start again to send more.',
      409,
      'submission_complete'
    )
  // Matching the presented link in the same read: it may have been replaced
  // since the submission was read.
  const record = await prisma.fileRequest.findFirst({
    where: { id: submission.requestId, token: token as string },
    include: {
      profile: { select: { id: true, name: true, options: true } },
      folder: { select: { id: true, name: true } },
    },
  })
  if (!record) throw unavailable('invalid')
  const status = fileRequestStatus(record)
  if (status !== 'open') throw unavailable(status)
  const context = await loadOwnerContext(record.userId)
  if (!context || deliveryProblem(context, record)) throw unavailable('paused')
  return { submission, record: record as FileRequestRecord, context }
}

/** Files arrive private with the request's profile or the account default. */
async function receivedUploadOptions(
  context: OwnerContext,
  record: FileRequestRecord
): Promise<ResolvedUploadOptions> {
  const resolved = await resolveUploadOptions(ownerUploader(context), {
    // Undefined follows the account's default profile, as a dashboard upload does.
    profileId: record.profileId ?? undefined,
    folderId: record.folderId,
  })
  const options = {
    ...resolved,
    visibility: 'PRIVATE' as const,
    password: null,
  }
  return options.expiryAction === 'SET_PRIVATE'
    ? { ...options, expiration: 'DISABLED', expiresAt: null }
    : options
}

/**
 * A file keeps the options it started with, minus a folder or tags the owner
 * deleted while it was uploading: it lands in Unfiled, without those tags.
 */
async function withoutDeletedDestinations(
  ownerId: string,
  options: ResolvedUploadOptions
): Promise<ResolvedUploadOptions> {
  const folder = options.folderId
    ? await prisma.vaultFolder.findFirst({
        where: { id: options.folderId, userId: ownerId },
        select: { id: true },
      })
    : null
  const tags = options.tagIds.length
    ? await prisma.vaultTag.findMany({
        where: { id: { in: options.tagIds }, userId: ownerId },
        select: { id: true },
      })
    : []
  return {
    ...options,
    folderId: folder?.id ?? null,
    tagIds: options.tagIds.filter((id) => tags.some((tag) => tag.id === id)),
  }
}

/**
 * Senders never learn about the owner's roles, folders, or tags. Problems on
 * the owner's side read as a paused request; limits keep their own message.
 */
export function senderError(error: unknown): unknown {
  if (error instanceof FileRequestError) return error
  if (error instanceof TagError || error instanceof FolderError)
    return unavailable('paused')
  if (error instanceof UploadError) {
    if (error.status === 401) return unavailable('invalid')
    if (error.status === 403) return unavailable('paused')
    if (error.status === 413)
      return /quota/i.test(error.message)
        ? new FileRequestError(
            'There isn’t enough storage space left to receive this file.',
            413,
            'quota'
          )
        : new FileRequestError(
            'This file is larger than the upload size limit.',
            413,
            'too_large'
          )
  }
  return error
}

const idleCutoff = () => new Date(Date.now() - UPLOAD_RESERVATION_IDLE_MS)

/**
 * Holds a new file's declared size against the request's limits and the
 * owner's quota, together with every other file still on its way, so
 * unfinished uploads can't take more room than the request allows.
 */
async function reserveUpload(
  uploadId: string,
  requestId: string,
  submissionId: string,
  size: number,
  context: OwnerContext,
  clientKey?: string
): Promise<{ uploadId: string; created: boolean }> {
  const { reserved, lapsed } = await prisma.$transaction(async (tx) => {
    // The owner's row first, as deliveries take it: starts across all of an
    // owner's requests take turns, so their quota holds can't overlap.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${context.account.id} FOR UPDATE`
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "FileRequest" WHERE "id" = ${requestId} FOR UPDATE`
    const request = locked.length
      ? await tx.fileRequest.findUnique({
          where: { id: requestId },
          select: {
            userId: true,
            closedAt: true,
            expiresAt: true,
            maxFiles: true,
            fileCount: true,
            maxBytes: true,
            bytesReceived: true,
          },
        })
      : null
    if (!request || request.userId !== context.account.id)
      throw unavailable('invalid')
    const status = fileRequestStatus(request)
    if (status !== 'open') throw unavailable(status)
    const cutoff = idleCutoff()
    if (clientKey) {
      const repeated = await tx.fileRequestUpload.findUnique({
        where: { submissionId_clientKey: { submissionId, clientKey } },
        select: { id: true, touchedAt: true, bytes: true },
      })
      // A retried start whose first response was lost.
      if (repeated && repeated.touchedAt > cutoff) {
        if (Number(repeated.bytes) !== size)
          throw new FileRequestError(
            'This retry key belongs to another file. Use a new key for each file.',
            409,
            'client_key_reused'
          )
        await tx.fileRequestUpload.update({
          where: { id: repeated.id },
          data: { touchedAt: new Date() },
        })
        return {
          reserved: { uploadId: repeated.id, created: false },
          lapsed: [],
        }
      }
    }
    const idle = await tx.fileRequestUpload.findMany({
      where: { requestId, touchedAt: { lte: cutoff } },
      select: { id: true },
    })
    await tx.fileRequestUpload.deleteMany({
      where: { id: { in: idle.map((upload) => upload.id) } },
    })
    const forRequest = await tx.fileRequestUpload.aggregate({
      where: { requestId },
      _count: { _all: true },
      _sum: { bytes: true },
    })
    const forBatch = await tx.fileRequestUpload.count({
      where: { submissionId },
    })
    const forOwner = await tx.fileRequestUpload.aggregate({
      where: { request: { userId: request.userId }, touchedAt: { gt: cutoff } },
      _sum: { bytes: true },
    })
    if (forBatch >= MAX_ACTIVE_UPLOADS_PER_BATCH)
      throw new FileRequestError(
        'Wait for the files already on their way to finish, then send this one.',
        409,
        'too_many_uploads'
      )
    if (forRequest._count._all >= MAX_ACTIVE_UPLOADS_PER_REQUEST)
      throw new FileRequestError(
        'Too many files are on their way to this request right now. Try again in a few minutes.',
        409,
        'busy'
      )
    if (
      request.maxFiles !== null &&
      request.fileCount + forRequest._count._all >= request.maxFiles
    )
      throw request.fileCount >= request.maxFiles
        ? unavailable('full')
        : new FileRequestError(
            'Files already on their way fill this request. Try again later.',
            409,
            'request_limit'
          )
    const onTheWay = Number(forRequest._sum.bytes ?? 0)
    if (
      request.maxBytes !== null &&
      Number(request.bytesReceived) + onTheWay + size > Number(request.maxBytes)
    )
      throw new FileRequestError(
        'This file is larger than the space left in this request.',
        413,
        'request_limit'
      )
    // Current usage, read under the owner's lock rather than before it.
    const owner = await tx.user.findUniqueOrThrow({
      where: { id: request.userId },
      select: { storageUsed: true },
    })
    const quota = remainingQuotaBytes({
      ...context,
      account: { ...context.account, storageUsed: owner.storageUsed },
    })
    if (size > quota - Number(forOwner._sum.bytes ?? 0))
      throw new FileRequestError(
        'There isn’t enough storage space left to receive this file.',
        413,
        'quota'
      )
    await tx.fileRequestUpload.create({
      data: {
        id: uploadId,
        requestId,
        submissionId,
        clientKey,
        bytes: BigInt(size),
      },
    })
    return { reserved: { uploadId, created: true }, lapsed: idle }
  })
  // A lapsed upload's parts go with its room, so disk use stays bounded.
  for (const { id } of lapsed) await discardUploadSession(id)
  return reserved
}

async function releaseUpload(uploadId: string) {
  await prisma.fileRequestUpload
    .deleteMany({ where: { id: uploadId } })
    .catch((error) =>
      loggers.files.warn('Could not release a file request upload', { error })
    )
}

async function discardUpload(
  storage: StorageProvider,
  metadata: Pick<UploadMetadata, 'fileKey' | 's3UploadId'>
) {
  await storage
    .abortMultipartUpload(metadata.fileKey, metadata.s3UploadId)
    .catch((error) =>
      loggers.files.warn('Could not discard unfinished upload parts', {
        error,
      })
    )
}

export async function startRequestUpload(
  token: unknown,
  key: unknown,
  body: unknown
) {
  const input = requestUploadInitSchema.parse(body)
  const { submission, record, context } = await openSession(
    token,
    key,
    input.submissionId
  )
  // A path in `filename` names the file, never a storage location.
  const filename = uploadDisplayName(input.filename)
  if (!filename) throw new FileRequestError('This file name isn’t valid.')
  const limit = maxUploadBytes(context.config)
  if (input.size > limit)
    throw new FileRequestError(
      `Files can be at most ${formatRequestBytes(limit)}.`,
      413,
      'too_large'
    )
  if (requestPartSize(input.size) > MAX_PART_BYTES)
    throw new FileRequestError(
      'This file is too large to send.',
      413,
      'too_large'
    )
  const owner = ownerUploader(context)
  const options = await receivedUploadOptions(context, record)
  const reserved = await reserveUpload(
    randomUUID().replace(/-/g, ''),
    record.id,
    submission.id,
    input.size,
    context,
    input.clientKey
  )
  if (!reserved.created) {
    // The first start may still be setting its upload up.
    if (!(await getUploadMetadata(reserved.uploadId)))
      throw new FileRequestError(
        'This file is still starting. Try again in a moment.',
        503,
        'starting'
      )
    return {
      uploadId: reserved.uploadId,
      partSize: requestPartSize(input.size),
    }
  }
  const uploadId = reserved.uploadId
  let storage: StorageProvider | undefined
  let started: { fileKey: string; s3UploadId: string } | undefined
  try {
    const destination = await prepareUploadDestination(owner, filename, options)
    storage = await getStorageProvider()
    started = {
      fileKey: destination.filePath,
      s3UploadId: await storage.initializeMultipartUpload(
        destination.filePath,
        input.mimeType
      ),
    }
    await saveUploadMetadata(uploadId, {
      fileKey: started.fileKey,
      filename: destination.displayName,
      mimeType: input.mimeType,
      totalSize: input.size,
      userId: owner.id,
      visibility: 'PRIVATE',
      password: null,
      passwordHash: null,
      lastActivity: Date.now(),
      urlPath: destination.urlPath,
      s3UploadId: started.s3UploadId,
      options,
      storageFingerprint: await fingerprint(),
      storageTarget: captureStorageTarget(storage),
      fileRequest: { requestId: record.id, submissionId: submission.id },
    })
  } catch (error) {
    if (storage && started) await discardUpload(storage, started)
    await releaseUpload(uploadId)
    throw error
  }
  return { uploadId, partSize: requestPartSize(input.size) }
}

/** The session a sender's key may use; the owner's checks run at completion. */
async function requireSenderUpload(
  token: unknown,
  key: unknown,
  uploadId: string
) {
  const submission = await findSubmission(token, key)
  const metadata = await getUploadMetadata(uploadId)
  if (
    !metadata?.fileRequest ||
    metadata.fileRequest.submissionId !== submission.id ||
    metadata.fileRequest.requestId !== submission.requestId ||
    metadata.userId !== submission.request.userId
  )
    throw uploadNotFound()
  if (
    metadata.storageFingerprint &&
    metadata.storageFingerprint !== (await fingerprint())
  )
    throw new FileRequestError(
      'Storage changed during this upload. Please send the file again.',
      409,
      'storage_changed'
    )
  return {
    submission,
    metadata: metadata as UploadMetadata &
      Required<Pick<UploadMetadata, 'fileRequest'>>,
  }
}

export async function uploadRequestPart(
  token: unknown,
  key: unknown,
  uploadId: string,
  partNumberValue: string,
  body: ReadableStream<Uint8Array> | null
) {
  const partNumber = Number(partNumberValue)
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS)
    throw new FileRequestError('Invalid part number.', 400, 'part_size')
  const { submission, metadata } = await requireSenderUpload(
    token,
    key,
    uploadId
  )
  // Parts stop as soon as the request can no longer take this file.
  const status = fileRequestStatus(submission.request)
  if (status !== 'open') throw unavailable(status)
  if (submission.completedAt)
    throw new FileRequestError(
      'These files were already sent. Start again to send more.',
      409,
      'submission_complete'
    )
  const touched = await prisma.fileRequestUpload.updateMany({
    where: {
      id: uploadId,
      submissionId: submission.id,
      touchedAt: { gt: idleCutoff() },
    },
    data: { touchedAt: new Date() },
  })
  if (!touched.count) throw uploadNotFound()
  if (!body) throw new FileRequestError('No upload part provided.')
  // Each part has the exact size the start response implied: partSize, and
  // the remainder for the last one. Nothing beyond that is buffered.
  const partSize = requestPartSize(metadata.totalSize)
  const count = Math.ceil(metadata.totalSize / partSize)
  if (partNumber > count)
    throw new FileRequestError('Invalid part number.', 400, 'part_size')
  const expected =
    partNumber < count ? partSize : metadata.totalSize - partSize * (count - 1)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > expected) {
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (size !== expected)
    throw new FileRequestError(
      `Part ${partNumber} must be exactly ${expected} bytes.`,
      size > expected ? 413 : 400,
      'part_size'
    )
  if (
    await prisma.file.findFirst({
      where: { path: metadata.fileKey },
      select: { id: true },
    })
  )
    throw new FileRequestError(
      'This file was already sent.',
      409,
      'upload_complete'
    )
  // Storage writes hold no database connection; only the part list is
  // updated under the session lock, so concurrent parts never lose an entry.
  const storage = await getUploadStorage(metadata)
  const result = await storage.uploadPart(
    metadata.fileKey,
    metadata.s3UploadId,
    partNumber,
    Buffer.concat(chunks)
  )
  await withUploadLock(uploadId, async () => {
    const current = await getUploadMetadata(uploadId)
    if (!current?.fileRequest) {
      // Cancelled or discarded while this part was arriving: local storage
      // recreated the parts directory, so remove the late write as well.
      await discardUpload(storage, metadata)
      throw uploadNotFound()
    }
    current.parts = [
      ...(current.parts ?? []).filter((part) => part.PartNumber !== partNumber),
      { PartNumber: partNumber, ETag: result.ETag, size },
    ].sort((a, b) => a.PartNumber - b.PartNumber)
    current.lastActivity = Date.now()
    await saveUploadMetadata(uploadId, current)
  })
  return { partNumber, size, etag: result.ETag }
}

function requestDelivery(
  requestId: string,
  token: string,
  submissionId: string,
  uploadId: string,
  sizeBytes: number
): UploadDelivery {
  return {
    fileRequestSubmissionId: submissionId,
    async check(tx, access) {
      if (!hasPermission(access, 'fileRequests.manage'))
        throw unavailable('paused')
      // The owner's settings changes and other deliveries lock the same row.
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "FileRequest" WHERE "id" = ${requestId} FOR UPDATE`
      const request = locked.length
        ? await tx.fileRequest.findUnique({
            where: { id: requestId },
            select: {
              token: true,
              closedAt: true,
              expiresAt: true,
              maxFiles: true,
              fileCount: true,
              maxBytes: true,
              bytesReceived: true,
            },
          })
        : null
      if (!request || request.token !== token) throw unavailable('invalid')
      const status = fileRequestStatus(request)
      if (status !== 'open') throw unavailable(status)
      if (
        request.maxBytes !== null &&
        Number(request.bytesReceived) + sizeBytes > Number(request.maxBytes)
      )
        throw new FileRequestError(
          'This file is larger than the space left in this request.',
          413,
          'request_limit'
        )
      const submission = await tx.fileRequestSubmission.findUnique({
        where: { id: submissionId },
        select: { requestId: true, completedAt: true },
      })
      if (
        !submission ||
        submission.requestId !== requestId ||
        submission.completedAt
      )
        throw invalidSession()
    },
    async record(tx) {
      await tx.fileRequest.update({
        where: { id: requestId },
        data: {
          fileCount: { increment: 1 },
          bytesReceived: { increment: BigInt(sizeBytes) },
          lastReceivedAt: new Date(),
        },
        select: { id: true },
      })
      await tx.fileRequestSubmission.update({
        where: { id: submissionId },
        data: {
          fileCount: { increment: 1 },
          bytes: { increment: BigInt(sizeBytes) },
        },
        select: { id: true },
      })
      // Delivered: the file's room is now counted by the request itself.
      await tx.fileRequestUpload.deleteMany({ where: { id: uploadId } })
    },
  }
}

export async function completeRequestUpload(
  token: unknown,
  key: unknown,
  uploadId: string
) {
  const { metadata } = await requireSenderUpload(token, key, uploadId)
  const findCommitted = () =>
    prisma.file.findFirst({
      where: { userId: metadata.userId, path: metadata.fileKey },
    })
  // A retry whose first response was lost gets the same answer, even if that
  // file filled the request or the batch has finished since.
  const committed = await findCommitted()
  if (committed)
    return deliveredResponse(metadata.fileRequest.requestId, committed)
  if (!metadata.options) throw uploadNotFound()
  const startedOptions = metadata.options
  // A cancelled or lapsed upload has no room left to complete into.
  const live = await prisma.fileRequestUpload.updateMany({
    where: { id: uploadId, touchedAt: { gt: idleCutoff() } },
    data: { touchedAt: new Date() },
  })
  if (!live.count) throw uploadNotFound()
  const presentedToken = token as string
  // Resolve the provider before entering the lock, as dashboard uploads do.
  const storage = await getUploadStorage(metadata)
  try {
    const { submission, record, context } = await openSession(
      token,
      key,
      metadata.fileRequest.submissionId
    )
    const owner = ownerUploader(context)
    const options = await withoutDeletedDestinations(owner.id, startedOptions)
    const result = await withUploadLock(uploadId, async (transaction) => {
      const existing = await transaction.file.findFirst({
        where: { userId: owner.id, path: metadata.fileKey },
      })
      if (existing) return { file: existing, created: false }
      // Read the parts under the lock that part uploads hold while recording.
      const parts = (await getUploadMetadata(uploadId))?.parts ?? []
      // Parts must cover the file exactly: 1..n, adding up to the declared size.
      if (
        !parts.length ||
        parts.some((part, index) => part.PartNumber !== index + 1) ||
        parts.reduce((total, part) => total + part.size, 0) !==
          metadata.totalSize
      )
        throw new FileRequestError(
          'Some parts of this file are missing. Send the remaining parts, then try again.',
          400,
          'incomplete_upload'
        )
      await storage.completeMultipartUpload(
        metadata.fileKey,
        metadata.s3UploadId,
        parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag }))
      )
      const size = await storage.getFileSize(metadata.fileKey)
      if (size !== metadata.totalSize)
        throw new FileRequestError(
          'The uploaded size doesn’t match the file. Please send it again.',
          400,
          'size_mismatch'
        )
      const file = await finalizeUpload({
        user: owner,
        storage,
        transaction,
        filePath: metadata.fileKey,
        urlPath: metadata.urlPath,
        displayName: metadata.filename,
        mimeType: metadata.mimeType,
        size,
        options,
        passwordHash: null,
        // The link the sender used, not the request's current one: a link
        // replaced mid-upload must stop this file.
        delivery: requestDelivery(
          record.id,
          presentedToken,
          submission.id,
          uploadId,
          size
        ),
      })
      return { file, created: true }
    })
    if (result.created) {
      // Senders are anonymous; this ties the new file to the request it came through.
      await recordAudit({
        action: 'file_request.received',
        category: 'file_requests',
        targetType: 'file',
        targetId: result.file.id,
        targetName: result.file.name,
        details: { requestId: record.id, ownerId: owner.id },
      })
      await recordDelivery(record.id)
      enqueueUploadProcessing(result.file)
    }
    return await deliveredResponse(record.id, result.file)
  } catch (error) {
    const committed = await findCommitted()
    if (committed)
      return deliveredResponse(metadata.fileRequest.requestId, committed)
    // A missing part can still be sent. Anything else ends this upload: its
    // bytes, unfinished parts, and hold on the request's limits are released.
    if (!(
      error instanceof FileRequestError && error.code === 'incomplete_upload'
    )) {
      await cleanupUncommittedUpload(storage, metadata.fileKey)
      await discardUpload(storage, metadata)
      await releaseUpload(uploadId)
    }
    throw senderError(error)
  }
}

/** Senders learn only that their file arrived, never its link in the owner's library. */
async function deliveredResponse(
  requestId: string,
  file: { name: string; size: number }
) {
  const record = await prisma.fileRequest.findUnique({
    where: { id: requestId },
    select: {
      maxFiles: true,
      fileCount: true,
      maxBytes: true,
      bytesReceived: true,
    },
  })
  return {
    file: { name: file.name, sizeBytes: Math.round(file.size * 1024 * 1024) },
    remaining: {
      files:
        record && record.maxFiles !== null
          ? Math.max(0, record.maxFiles - record.fileCount)
          : null,
      bytes:
        record && record.maxBytes !== null
          ? Math.max(0, Number(record.maxBytes) - Number(record.bytesReceived))
          : null,
    },
  }
}

/**
 * Gives up on a file: its parts are discarded and its room goes back to the
 * request. A file that already arrived stays.
 */
export async function cancelRequestUpload(
  token: unknown,
  key: unknown,
  uploadId: string
) {
  const { metadata } = await requireSenderUpload(token, key, uploadId)
  // Under the session lock, so a completion in progress finishes first.
  await withUploadLock(uploadId, async (transaction) => {
    if (
      await transaction.file.findFirst({
        where: { userId: metadata.userId, path: metadata.fileKey },
        select: { id: true },
      })
    )
      throw new FileRequestError(
        'This file was already sent.',
        409,
        'upload_complete'
      )
    await discardUploadSession(uploadId)
  })
  await releaseUpload(uploadId)
  return { cancelled: true }
}

/** Marks a sender's batch finished. Repeating it is harmless. */
export async function completeSubmission(
  token: unknown,
  key: unknown,
  submissionId: string
) {
  const submission = await findSubmission(token, key)
  if (submission.id !== submissionId) throw invalidSession()
  if (!submission.completedAt) {
    const { count } = await prisma.fileRequestSubmission.updateMany({
      where: { id: submission.id, completedAt: null },
      data: { completedAt: new Date() },
    })
    if (count && submission.fileCount > 0)
      await recordDelivery(submission.requestId, { batchFinished: true })
  }
  return {
    fileCount: submission.fileCount,
    bytes: Number(submission.bytes),
  }
}
