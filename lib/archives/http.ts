import { z } from 'zod'

import { setAuditActor, setAuditOutcome } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { folderIdSchema, folderNameSchema } from '@/lib/folders/schema'
import { HttpError } from '@/lib/http/errors'
import { prismaAnswers } from '@/lib/http/prisma'
import { mediaType, readBody } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import type { RouteContract } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { StorageTargetChangedError } from '@/lib/storage/target-provider'
import { isoDateTimeWithOffset } from '@/lib/utils/iso-datetime'

import { ArchiveError } from './errors'
import type { ArchiveEntrySelector } from './index-cache'
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
    profileRevision: isoDateTimeWithOffset.optional(),
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
    profileRevision: isoDateTimeWithOffset.optional(),
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

/**
 * Read `entry` (a listing position) or `path` from entry request parameters.
 * Positions keep member names out of URLs that media elements must fetch.
 */
export function entrySelector(query: URLSearchParams): ArchiveEntrySelector {
  const position = query.get('entry')
  if (position === null) return { path: query.get('path') ?? '' }
  if (!/^\d{1,9}$/.test(position))
    throw new ArchiveError('Choose a valid archive entry.', 400)
  return { position: Number(position) }
}

/** `progress` opts into 202 polling; `after` skips entries already received. */
export function parseListingQuery(input: {
  progress?: unknown
  after?: unknown
}) {
  const after = Number(input.after ?? 0)
  return {
    progress: input.progress === true || input.progress === '1',
    after: Number.isSafeInteger(after) && after > 0 ? after : 0,
  }
}

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
  setAuditActor({ id: user.id, name: user.name })
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
  const form =
    allowForm && mediaType(request) === 'application/x-www-form-urlencoded'
  if (mediaType(request) !== 'application/json' && !form)
    throw new ArchiveError(
      allowForm ? 'Use JSON or a URL-encoded form.' : 'Use application/json.',
      415
    )
  if (!request.body) throw new ArchiveError('Invalid archive request.', 400)
  let text: string
  try {
    text = (await readBody(request, 16384, signal)).toString('utf8')
  } catch (error) {
    if (error instanceof HttpError && error.status === 413)
      throw new ArchiveError('Archive request is too large.', 413)
    throw error
  }
  if (!form) {
    try {
      return JSON.parse(text)
    } catch {
      throw new ArchiveError('Invalid JSON.', 400)
    }
  }
  const fields = new URLSearchParams(text)
  if ([...fields.keys()].some((key) => fields.getAll(key).length !== 1))
    throw new ArchiveError('Use each archive field only once.', 400)
  return Object.fromEntries(fields)
}

const changed = new HttpError(
  409,
  'A source file, account, or destination changed. Refresh and try again.'
)
const prismaConflicts = prismaAnswers({
  P2002: new HttpError(
    409,
    'A folder with that name already exists here. Choose another name.'
  ),
  P2003: changed,
  P2025: changed,
})

/** Archive routes: private, never cached, and answered in the API envelope. */
export const archiveRoutes: RouteContract = {
  envelope: 'api',
  respond: apiResponse,
  headers: { 'Cache-Control': 'private, no-store' },
  translate: (error) => {
    // A final access recheck may fail inside a transaction's scoped context.
    if (error instanceof ArchiveError && error.accessDenied)
      setAuditOutcome('denied')
    if (error instanceof HttpError && error.status === 429)
      return new HttpError(429, error.message, {
        headers: {
          'Retry-After': String(
            (error instanceof ArchiveError && error.retryAfterSeconds) || 5
          ),
        },
      })
    if (
      ['AbortError', 'ResponseAborted'].includes(
        (error as { name?: string })?.name ?? ''
      )
    )
      // The browser left: a closed preview or a seek that replaced a request.
      return new HttpError(408, 'Archive request was cancelled.')
    if (error instanceof StorageTargetChangedError)
      return new HttpError(
        409,
        'The file storage configuration has changed. Ask the operator to restore its recorded storage target.'
      )
    return prismaConflicts(error)
  },
  invalid: (error) =>
    new HttpError(400, error.issues[0]?.message || 'Invalid archive request.'),
  failure: { message: 'Archive operation could not be completed.' },
  logger: loggers.files,
}
