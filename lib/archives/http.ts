import { Prisma } from '@prisma/client'
import { ZodError, z } from 'zod'

import { apiError, apiResponse } from '@/lib/api/response'
import { getAccessSession } from '@/lib/auth'
import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { folderIdSchema, folderNameSchema } from '@/lib/folders/schema'
import { FolderError } from '@/lib/folders/service'
import { loggers } from '@/lib/logger'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { PermissionError, getUserAccess } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { StorageTargetChangedError } from '@/lib/storage/target-provider'
import { UploadError } from '@/lib/uploads/options'

import { ArchiveError } from './errors'
import { ARCHIVE_LIMITS } from './shared'

export type ArchiveActor = { user: AuthenticatedUser; sessionVersion: number }

export const createArchiveSchema = z
  .object({
    fileIds: z
      .array(folderIdSchema)
      .min(1)
      .max(ARCHIVE_LIMITS.selectedFiles)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Select each file only once.'
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (name) =>
          !/[\\/\p{Cc}\p{Cf}]/u.test(name) && name !== '.' && name !== '..',
        'Use a plain filename without slashes.'
      ),
    format: z.enum(['zip', 'tar.gz']),
    folderId: folderIdSchema.nullable(),
    profileId: z.string().min(1).max(100).nullable().optional(),
    profileRevision: z.string().datetime({ offset: true }).optional(),
    profileEffectiveRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      (!input.profileRevision && !input.profileEffectiveRevision) ||
      !!input.profileId,
    'Choose a profile when supplying its revision.'
  )
export const extractArchiveSchema = z
  .object({
    folderId: folderIdSchema.nullable(),
    name: folderNameSchema,
    profileId: z.string().min(1).max(100).nullable().optional(),
    profileRevision: z.string().datetime({ offset: true }).optional(),
    profileEffectiveRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      (!input.profileRevision && !input.profileEffectiveRevision) ||
      !!input.profileId,
    'Choose a profile when supplying its revision.'
  )

export async function archiveActor(
  request: Request,
  permissions: Permission[]
): Promise<ArchiveActor> {
  if (request.headers.has('authorization'))
    throw new ArchiveError('Use a browser session for archives.', 401)
  if (request.method !== 'GET' && !isSameOriginRequest(request))
    throw new ArchiveError('Forbidden', 403)
  const session = await getAccessSession()
  if (!session?.user?.id) throw new ArchiveError('Sign in to continue.', 401)
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user || user.sessionVersion !== session.user.sessionVersion)
    throw new ArchiveError('Sign in again to continue.', 401)
  const access = await getUserAccess(user.id)
  if (permissions.some((permission) => !hasPermission(access, permission)))
    throw new ArchiveError(
      'You do not have permission for this archive operation.',
      403
    )
  return {
    user: {
      id: user.id,
      urlId: user.urlId,
      vanityId: user.vanityId,
      storageUsed: user.storageUsed,
      randomizeFileUrls: user.randomizeFileUrls,
      ...access,
    },
    sessionVersion: user.sessionVersion,
  }
}

export async function archiveBody(
  request: Request,
  signal?: AbortSignal,
  allowForm = false
) {
  const contentType = request.headers
    .get('content-type')
    ?.split(';')[0]
    .trim()
    .toLowerCase()
  const form = allowForm && contentType === 'application/x-www-form-urlencoded'
  if (contentType !== 'application/json' && !form)
    throw new ArchiveError(
      allowForm ? 'Use JSON or a URL-encoded form.' : 'Use application/json.',
      415
    )
  const reader = request.body?.getReader()
  if (!reader) throw new ArchiveError('Invalid archive request.', 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 16384) {
        void reader.cancel().catch(() => {})
        throw new ArchiveError('Archive request is too large.', 413)
      }
      chunks.push(value)
    }
    signal?.throwIfAborted()
    const text = Buffer.concat(chunks).toString('utf8')
    if (!form) return JSON.parse(text)
    const fields = new URLSearchParams(text)
    if ([...fields.keys()].some((key) => fields.getAll(key).length !== 1))
      throw new ArchiveError('Use each archive field only once.', 400)
    return Object.fromEntries(fields)
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

export async function archiveRoute(action: () => Promise<unknown>) {
  try {
    const value = await action()
    const response = value instanceof Response ? value : apiResponse(value)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    let status = 500
    let message = 'Archive operation could not be completed.'
    if (
      error instanceof ArchiveError ||
      error instanceof UploadError ||
      error instanceof FolderError ||
      error instanceof PermissionError
    ) {
      status = error.status
      message = error.message
    } else if (error instanceof ZodError) {
      status = 400
      message = error.issues[0]?.message || 'Invalid archive request.'
    } else if (error instanceof SyntaxError) {
      status = 400
      message = 'Invalid JSON.'
    } else if (error instanceof StorageTargetChangedError) {
      status = 409
      message =
        'The file storage configuration has changed. Ask the operator to restore its recorded storage target.'
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      status = 409
      message =
        'A folder with that name already exists here. Choose another name.'
    } else if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2003', 'P2025'].includes(error.code)
    ) {
      status = 409
      message =
        'A source file, account, or destination changed. Refresh and try again.'
    } else loggers.files.error('Archive operation failed', error as Error)
    const response = apiError(message, status)
    response.headers.set('Cache-Control', 'private, no-store')
    if (status === 429) response.headers.set('Retry-After', '5')
    return response
  }
}
