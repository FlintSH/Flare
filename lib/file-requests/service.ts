import type { Prisma } from '@prisma/client'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG, type FlareConfig, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import { hasVerifiedEmail, requiresEmailVerification } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import { validateOwnedFolderId } from '@/lib/folders/service'
import { hasPermission } from '@/lib/permissions/catalog'
import {
  PermissionError,
  type UserAccess,
  ensureBuiltInRoles,
  getUserAccess,
  lockRoleChanges,
  requireActorPermission,
} from '@/lib/permissions/server'
import { accountUploadOptions } from '@/lib/uploads/effective-settings'
import { UploadError } from '@/lib/uploads/options'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  uploadProfileOptionsSchema,
} from '@/lib/uploads/schema'

import {
  FILE_REQUEST_LINK_MESSAGES,
  type FileRequestCreateInput,
  type FileRequestLinkStatus,
  type FileRequestListQuery,
  type FileRequestPolicyView,
  type FileRequestStatus,
  type FileRequestSubmissionView,
  type FileRequestUpdateInput,
  type FileRequestView,
  MAX_OPEN_FILE_REQUESTS,
  NOTIFICATION_INTERVAL_MS,
  type PublicFileRequestView,
  type SenderNameMode,
  type SubmissionCreateInput,
  fileRequestStatus,
} from './policy'
import {
  createFileRequestToken,
  createSubmissionKey,
  isFileRequestToken,
} from './tokens'

type Client = Prisma.TransactionClient | typeof prisma

/** Statuses carry a stable `code` so senders and scripts can react to them. */
export class FileRequestError extends UploadError {
  constructor(
    message: string,
    status = 400,
    public readonly code = 'invalid_request'
  ) {
    super(message, status)
    this.name = 'FileRequestError'
  }
}

const UNAVAILABLE_STATUS: Record<
  Exclude<FileRequestLinkStatus, 'open'>,
  number
> = { invalid: 404, closed: 410, expired: 410, full: 409, paused: 409 }

export function unavailable(status: Exclude<FileRequestLinkStatus, 'open'>) {
  const message = FILE_REQUEST_LINK_MESSAGES[status]
  return new FileRequestError(
    `${message.title}. ${message.description}`,
    UNAVAILABLE_STATUS[status],
    status
  )
}

const requestSelect = {
  id: true,
  userId: true,
  token: true,
  title: true,
  message: true,
  senderName: true,
  profileId: true,
  folderId: true,
  maxFiles: true,
  maxBytes: true,
  expiresAt: true,
  closedAt: true,
  notify: true,
  fileCount: true,
  bytesReceived: true,
  lastReceivedAt: true,
  seenAt: true,
  createdAt: true,
  updatedAt: true,
  profile: { select: { id: true, name: true, options: true } },
  folder: { select: { id: true, name: true } },
} as const satisfies Prisma.FileRequestSelect
export type FileRequestRecord = Prisma.FileRequestGetPayload<{
  select: typeof requestSelect
}>

const ownerSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  emailVerifiedFor: true,
  emailVerificationSource: true,
  emailExempt: true,
  createdAt: true,
  storageUsed: true,
  urlId: true,
  vanityId: true,
  randomizeFileUrls: true,
  defaultUploadProfileId: true,
  defaultFileExpiration: true,
  defaultFileExpirationAction: true,
} as const satisfies Prisma.UserSelect

export interface OwnerContext {
  account: Prisma.UserGetPayload<{ select: typeof ownerSelect }>
  access: UserAccess
  config: FlareConfig
  email: EmailConfig
  defaultProfileOptions: UploadProfileOptions
}

async function readConfig(client: Client): Promise<FlareConfig> {
  const row = await client.config.findUnique({
    where: { key: 'flare_config' },
  })
  return row ? configSchema.parse(row.value) : DEFAULT_CONFIG
}

export async function loadOwnerContext(
  userId: string,
  client: Client = prisma
): Promise<OwnerContext | null> {
  const [account, access, config, email] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: ownerSelect }),
    getUserAccess(userId, client),
    readConfig(client),
    // Inside a transaction, read email policy through it: the global client
    // could wait on a lock this transaction already holds.
    client === prisma
      ? getEmailConfig()
      : getEmailConfigForUpdate(client as Prisma.TransactionClient),
  ])
  if (!account) return null
  const defaultProfile = account.defaultUploadProfileId
    ? await client.uploadProfile.findFirst({
        where: { id: account.defaultUploadProfileId, userId },
        select: { options: true },
      })
    : null
  return {
    account,
    access,
    config,
    email,
    defaultProfileOptions: defaultProfile
      ? uploadProfileOptionsSchema.parse(defaultProfile.options)
      : {},
  }
}

/** The owner as an uploader. Publishing re-reads the account and roles under lock. */
export function ownerUploader(context: OwnerContext): AuthenticatedUser {
  const { id, storageUsed, urlId, vanityId, randomizeFileUrls } =
    context.account
  return {
    id,
    storageUsed,
    urlId,
    vanityId,
    randomizeFileUrls,
    ...context.access,
  }
}

export function maxUploadBytes(config: FlareConfig) {
  const { value, unit } = config.settings.general.storage.maxUploadSize
  return value * (unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
}

/** Remaining quota in bytes, or Infinity when no quota applies to the owner. */
export function remainingQuotaBytes(context: OwnerContext) {
  const { quotas } = context.config.settings.general.storage
  if (!quotas.enabled || hasPermission(context.access, 'quotas.bypass'))
    return Infinity
  const quotaMB =
    quotas.default.value * (quotas.default.unit === 'GB' ? 1024 : 1)
  return Math.max(0, (quotaMB - context.account.storageUsed) * 1024 ** 2)
}

/**
 * What files sent through a request receive: its upload profile (or the
 * account default) over account defaults. Received files always arrive
 * private, so an expiration that only makes files private does nothing.
 */
export function receivedFileOptions(
  context: OwnerContext,
  profileOptions: unknown | null
): Required<UploadProfileOptions> {
  const profile =
    profileOptions === null
      ? context.defaultProfileOptions
      : uploadProfileOptionsSchema.parse(profileOptions)
  const options = {
    ...UPLOAD_DEFAULTS,
    ...accountUploadOptions(context.account, context.config),
    ...profile,
    visibility: 'PRIVATE' as const,
  }
  return options.expiryAction === 'SET_PRIVATE'
    ? { ...options, expiration: 'DISABLED' }
    : options
}

function destinationProblem(
  access: UserAccess,
  options: Required<UploadProfileOptions>,
  folderId: string | null
) {
  if (folderId && !hasPermission(access, 'folders.manage'))
    return 'Your roles don’t allow saving files into folders. Choose Unfiled instead.'
  if (options.tagIds.length && !hasPermission(access, 'tags.manage'))
    return 'Its upload profile adds tags, which your roles don’t allow. Choose another profile.'
  if (
    options.expiration !== 'DISABLED' &&
    !hasPermission(access, 'files.delete')
  )
    return 'Its upload profile deletes files after a while, which your roles don’t allow. Choose another profile.'
  return null
}

/** Why an otherwise open request can't receive files. Shown only to its owner. */
export function deliveryProblem(
  context: OwnerContext,
  record: Pick<FileRequestRecord, 'folderId' | 'profileId'> & {
    profile: { options: unknown } | null
  }
): string | null {
  const { account, access, email } = context
  if (requiresEmailVerification(account, email))
    return 'Verify your email address to receive files.'
  if (!hasPermission(access, 'fileRequests.manage'))
    return 'Your roles no longer allow file requests.'
  if (!hasPermission(access, 'files.upload'))
    return 'Your roles no longer allow uploads.'
  const problem = destinationProblem(
    access,
    receivedFileOptions(context, record.profile?.options ?? null),
    record.folderId
  )
  if (problem) return problem
  if (remainingQuotaBytes(context) <= 0)
    return 'Your storage is full. Free up space to receive files.'
  return null
}

function present(
  record: FileRequestRecord,
  context: OwnerContext | null,
  now = new Date()
): FileRequestView {
  let status: FileRequestStatus = fileRequestStatus(record, now)
  let pausedReason: string | null = null
  if (status === 'open') {
    pausedReason = context
      ? deliveryProblem(context, record)
      : 'Your account no longer has access.'
    if (pausedReason) status = 'paused'
  }
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    status,
    pausedReason,
    token: record.token,
    senderName: record.senderName as SenderNameMode,
    profile: record.profile
      ? { id: record.profile.id, name: record.profile.name }
      : null,
    folder: record.folder,
    maxFiles: record.maxFiles,
    maxBytes: record.maxBytes === null ? null : Number(record.maxBytes),
    fileCount: record.fileCount,
    bytesReceived: Number(record.bytesReceived),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    closedAt: record.closedAt?.toISOString() ?? null,
    notify: record.notify,
    lastReceivedAt: record.lastReceivedAt?.toISOString() ?? null,
    unseen: Boolean(
      record.lastReceivedAt &&
      (!record.seenAt || record.seenAt < record.lastReceivedAt)
    ),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/** Requests that can still receive files, apart from the owner's own access. */
export function openRequestWhere(now: Date): Prisma.FileRequestWhereInput {
  return {
    closedAt: null,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        OR: [
          { maxFiles: null },
          { fileCount: { lt: prisma.fileRequest.fields.maxFiles } },
        ],
      },
      {
        OR: [
          { maxBytes: null },
          { bytesReceived: { lt: prisma.fileRequest.fields.maxBytes } },
        ],
      },
    ],
  }
}

function canNotify(context: OwnerContext) {
  return (
    context.email.enabled && hasVerifiedEmail(context.account, context.email)
  )
}

export async function getFileRequestPolicy(
  userId: string,
  context: OwnerContext
): Promise<FileRequestPolicyView> {
  return {
    canCreate:
      hasPermission(context.access, 'fileRequests.manage') &&
      hasPermission(context.access, 'files.upload'),
    openCount: await prisma.fileRequest.count({
      where: { userId, ...openRequestWhere(new Date()) },
    }),
    maxOpen: MAX_OPEN_FILE_REQUESTS,
    canNotify: canNotify(context),
  }
}

async function requireOwnerContext(userId: string, client: Client = prisma) {
  const context = await loadOwnerContext(userId, client)
  if (!context) throw new PermissionError('Your account no longer has access')
  return context
}

export async function listFileRequests(
  userId: string,
  query: FileRequestListQuery
) {
  const context = await requireOwnerContext(userId)
  const now = new Date()
  const where: Prisma.FileRequestWhereInput = {
    userId,
    ...(query.status === 'open'
      ? openRequestWhere(now)
      : query.status === 'ended'
        ? { NOT: openRequestWhere(now) }
        : {}),
  }
  const total = await prisma.fileRequest.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, pageCount)
  const records = await prisma.fileRequest.findMany({
    where,
    select: requestSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * query.limit,
    take: query.limit,
  })
  return {
    requests: records.map((record) => present(record, context, now)),
    pagination: { total, pageCount, page, limit: query.limit },
    policy: await getFileRequestPolicy(userId, context),
  }
}

export const SUBMISSIONS_PAGE_SIZE = 20
/** Larger batches link to the library instead of listing every file here. */
export const FILES_PER_SUBMISSION = 100

export async function getFileRequest(
  userId: string,
  id: string,
  requestedPage = 1
) {
  const context = await requireOwnerContext(userId)
  const record = await prisma.fileRequest.findFirst({
    where: { id, userId },
    select: requestSelect,
  })
  if (!record) throw new FileRequestError('File request not found.', 404)
  // Abandoned visits that never delivered a file are not shown.
  const where = { requestId: id, fileCount: { gt: 0 } }
  const total = await prisma.fileRequestSubmission.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / SUBMISSIONS_PAGE_SIZE))
  const page = Math.min(Math.max(1, requestedPage), pageCount)
  const submissions = await prisma.fileRequestSubmission.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * SUBMISSIONS_PAGE_SIZE,
    take: SUBMISSIONS_PAGE_SIZE,
    select: {
      id: true,
      senderName: true,
      note: true,
      createdAt: true,
      completedAt: true,
      fileCount: true,
      bytes: true,
      files: {
        where: { userId },
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        take: FILES_PER_SUBMISSION,
        select: {
          id: true,
          name: true,
          size: true,
          mimeType: true,
          urlPath: true,
          uploadedAt: true,
        },
      },
      _count: { select: { files: { where: { userId } } } },
    },
  })
  // Opening a request marks its arrivals as seen. Like view counters, this
  // bookkeeping is not an audited change.
  if (
    record.lastReceivedAt &&
    (!record.seenAt || record.seenAt < record.lastReceivedAt)
  )
    await prisma.fileRequest.update({
      where: { id },
      data: { seenAt: new Date() },
      select: { id: true },
    })
  return {
    request: present(record, context),
    submissions: submissions.map(
      (submission): FileRequestSubmissionView & { remainingFiles: number } => ({
        id: submission.id,
        senderName: submission.senderName,
        note: submission.note,
        createdAt: submission.createdAt.toISOString(),
        completedAt: submission.completedAt?.toISOString() ?? null,
        fileCount: submission.fileCount,
        bytes: Number(submission.bytes),
        files: submission.files.map((file) => ({
          id: file.id,
          name: file.name,
          sizeBytes: Math.round(file.size * 1024 * 1024),
          mimeType: file.mimeType,
          urlPath: file.urlPath,
          uploadedAt: file.uploadedAt.toISOString(),
        })),
        remainingFiles: Math.max(
          0,
          submission._count.files - submission.files.length
        ),
      })
    ),
    pagination: {
      total,
      pageCount,
      page,
      limit: SUBMISSIONS_PAGE_SIZE,
    },
  }
}

/** Reject destinations that would make every delivery fail. */
async function assertDestination(
  tx: Prisma.TransactionClient,
  userId: string,
  access: UserAccess,
  profileId: string | null,
  folderId: string | null
) {
  const profile = profileId
    ? await tx.uploadProfile.findFirst({
        where: { id: profileId, userId },
        select: { options: true },
      })
    : null
  if (profileId && !profile)
    throw new FileRequestError('Upload profile not found.', 404)
  if (folderId) {
    try {
      await validateOwnedFolderId(userId, folderId, tx)
    } catch {
      throw new FileRequestError('Folder not found.', 404)
    }
  }
  const context = await requireOwnerContext(userId, tx)
  const problem = destinationProblem(
    access,
    receivedFileOptions(context, profile?.options ?? null),
    folderId
  )
  if (problem) throw new FileRequestError(problem, 400)
}

async function requireRequestAccess(
  tx: Prisma.TransactionClient,
  userId: string
) {
  const access = await requireActorPermission(tx, userId, 'fileRequests.manage')
  if (!hasPermission(access, 'files.upload'))
    throw new PermissionError(
      'Your roles must also allow uploads to request files'
    )
  return access
}

function expiryFrom(hours: number | null) {
  return hours === null ? null : new Date(Date.now() + hours * 3_600_000)
}

export async function createFileRequest(
  userId: string,
  input: FileRequestCreateInput
) {
  const record = await prisma.$transaction(async (tx) => {
    // Same order as role changes, so a revoked permission cannot race creation.
    await lockRoleChanges(tx)
    const access = await requireRequestAccess(tx, userId)
    const open = await tx.fileRequest.count({
      where: { userId, ...openRequestWhere(new Date()) },
    })
    if (open >= MAX_OPEN_FILE_REQUESTS)
      throw new FileRequestError(
        `You can have ${MAX_OPEN_FILE_REQUESTS} open file requests at a time. Close one first.`,
        409
      )
    await assertDestination(tx, userId, access, input.profileId, input.folderId)
    return tx.fileRequest.create({
      data: {
        userId,
        token: createFileRequestToken(),
        title: input.title,
        message: input.message,
        senderName: input.senderName,
        profileId: input.profileId,
        folderId: input.folderId,
        maxFiles: input.maxFiles,
        maxBytes: input.maxBytes === null ? null : BigInt(input.maxBytes),
        expiresAt: expiryFrom(input.expiresInHours),
        notify: input.notify,
      },
      select: requestSelect,
    })
  })
  return present(record, await loadOwnerContext(userId))
}

export async function updateFileRequest(
  userId: string,
  id: string,
  input: FileRequestUpdateInput
) {
  const record = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const access = await requireRequestAccess(tx, userId)
    // Deliveries lock the same row, so limits and links change atomically.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "FileRequest" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`
    if (!locked.length)
      throw new FileRequestError('File request not found.', 404)
    const current = await tx.fileRequest.findUniqueOrThrow({
      where: { id },
      select: requestSelect,
    })
    const now = new Date()
    const data: Prisma.FileRequestUpdateInput = {}
    if (input.title !== undefined) data.title = input.title
    if (input.message !== undefined) data.message = input.message
    if (input.senderName !== undefined) data.senderName = input.senderName
    if (input.maxFiles !== undefined) data.maxFiles = input.maxFiles
    if (input.maxBytes !== undefined)
      data.maxBytes = input.maxBytes === null ? null : BigInt(input.maxBytes)
    if (input.expiresInHours !== undefined)
      data.expiresAt = expiryFrom(input.expiresInHours)
    if (input.notify !== undefined) data.notify = input.notify
    // Email starts with recent arrivals, not everything received so far, and
    // the first one isn't held back by the interval between emails.
    if (input.notify && !current.notify)
      data.notifiedAt = new Date(now.getTime() - NOTIFICATION_INTERVAL_MS)
    if (input.closed !== undefined)
      data.closedAt = input.closed ? (current.closedAt ?? now) : null
    if (input.replaceLink) data.token = createFileRequestToken()
    if (input.profileId !== undefined)
      data.profile = input.profileId
        ? { connect: { id: input.profileId } }
        : { disconnect: true }
    if (input.folderId !== undefined)
      data.folder = input.folderId
        ? { connect: { id: input.folderId } }
        : { disconnect: true }
    const wasOpen = fileRequestStatus(current, now) === 'open'
    const next = {
      ...current,
      closedAt:
        data.closedAt !== undefined
          ? (data.closedAt as Date | null)
          : current.closedAt,
      expiresAt:
        data.expiresAt !== undefined
          ? (data.expiresAt as Date | null)
          : current.expiresAt,
      maxFiles:
        input.maxFiles !== undefined ? input.maxFiles : current.maxFiles,
      maxBytes:
        input.maxBytes !== undefined
          ? input.maxBytes === null
            ? null
            : BigInt(input.maxBytes)
          : current.maxBytes,
    }
    const opens = !wasOpen && fileRequestStatus(next, now) === 'open'
    if (
      input.profileId !== undefined ||
      input.folderId !== undefined ||
      opens
    ) {
      await assertDestination(
        tx,
        userId,
        access,
        input.profileId !== undefined ? input.profileId : current.profileId,
        input.folderId !== undefined ? input.folderId : current.folderId
      )
      // This request is not open yet, so it is not part of the count.
      if (
        opens &&
        (await tx.fileRequest.count({
          where: { userId, ...openRequestWhere(now) },
        })) >= MAX_OPEN_FILE_REQUESTS
      )
        throw new FileRequestError(
          `You can have ${MAX_OPEN_FILE_REQUESTS} open file requests at a time. Close one first.`,
          409
        )
    }
    return tx.fileRequest.update({
      where: { id },
      data,
      select: requestSelect,
    })
  })
  return present(record, await loadOwnerContext(userId))
}

/** Received files stay in the library; only the link and sender notes go. */
export async function deleteFileRequest(userId: string, id: string) {
  const owned = await prisma.fileRequest.findFirst({
    where: { id, userId },
    select: { id: true },
  })
  if (!owned) throw new FileRequestError('File request not found.', 404)
  try {
    await prisma.fileRequest.delete({ where: { id }, select: { id: true } })
  } catch (error) {
    // Deleted by a concurrent request after the ownership check.
    if ((error as { code?: string }).code === 'P2025')
      throw new FileRequestError('File request not found.', 404)
    throw error
  }
}

/** Read-only view for the public page. Uploads recheck everything under lock. */
export async function inspectFileRequest(token: unknown): Promise<
  | {
      status: 'open'
      request: PublicFileRequestView
      record: FileRequestRecord
      context: OwnerContext
    }
  | { status: Exclude<FileRequestLinkStatus, 'open'> }
> {
  if (!isFileRequestToken(token)) return { status: 'invalid' }
  const record = await prisma.fileRequest.findUnique({
    where: { token },
    select: requestSelect,
  })
  if (!record) return { status: 'invalid' }
  const status = fileRequestStatus(record)
  if (status !== 'open') return { status }
  const context = await loadOwnerContext(record.userId)
  if (!context || deliveryProblem(context, record)) return { status: 'paused' }
  return {
    status: 'open',
    request: publicView(record, context),
    record,
    context,
  }
}

export function publicView(
  record: Pick<
    FileRequestRecord,
    | 'title'
    | 'message'
    | 'senderName'
    | 'maxFiles'
    | 'fileCount'
    | 'maxBytes'
    | 'bytesReceived'
    | 'expiresAt'
  >,
  context: OwnerContext
): PublicFileRequestView {
  return {
    title: record.title,
    message: record.message,
    ownerName: context.account.name,
    senderName: record.senderName as SenderNameMode,
    maxFileBytes: maxUploadBytes(context.config),
    filesRemaining:
      record.maxFiles === null
        ? null
        : Math.max(0, record.maxFiles - record.fileCount),
    bytesRemaining:
      record.maxBytes === null
        ? null
        : Math.max(0, Number(record.maxBytes) - Number(record.bytesReceived)),
    expiresAt: record.expiresAt?.toISOString() ?? null,
  }
}

/** A visit that never sent a file is removed after a day. */
const ABANDONED_SUBMISSION_MS = 24 * 3_600_000

export async function createSubmission(
  token: unknown,
  input: SubmissionCreateInput
) {
  const inspection = await inspectFileRequest(token)
  if (inspection.status !== 'open') throw unavailable(inspection.status)
  const { record, request } = inspection
  const senderName = request.senderName === 'off' ? '' : input.senderName
  if (request.senderName === 'required' && !senderName)
    throw new FileRequestError('Enter your name.', 400, 'name_required')
  await prisma.fileRequestSubmission.deleteMany({
    where: {
      requestId: record.id,
      fileCount: 0,
      createdAt: { lt: new Date(Date.now() - ABANDONED_SUBMISSION_MS) },
    },
  })
  const { key, hash } = createSubmissionKey()
  const submission = await prisma.fileRequestSubmission.create({
    data: {
      requestId: record.id,
      keyHash: hash,
      senderName,
      note: input.note,
    },
    select: { id: true },
  })
  return { submission: { id: submission.id, key }, request }
}

export async function everyoneCanRequestFiles(client: Client = prisma) {
  const everyone = await client.role.findUnique({
    where: { systemKey: 'everyone' },
    select: { permissions: true },
  })
  return Boolean(everyone?.permissions.includes('fileRequests.manage'))
}

/** The Settings switch is a shortcut for Everyone's Request files grant. */
export async function setEveryoneCanRequestFiles(
  actorId: string,
  enabled: boolean
) {
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const access = await requireActorPermission(tx, actorId, 'settings.general')
    if (!hasPermission(access, 'fileRequests.manage'))
      throw new PermissionError(
        'You can only change who may request files when you can request files yourself'
      )
    const { everyone } = await ensureBuiltInRoles(tx)
    if (everyone.permissions.includes('fileRequests.manage') !== enabled)
      await tx.role.update({
        where: { id: everyone.id },
        data: {
          permissions: enabled
            ? [...everyone.permissions, 'fileRequests.manage']
            : everyone.permissions.filter(
                (permission) => permission !== 'fileRequests.manage'
              ),
        },
      })
    return { everyoneCanRequestFiles: enabled }
  })
}
