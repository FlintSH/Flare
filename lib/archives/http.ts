import { z } from 'zod'

import { setAuditActor, setAuditOutcome } from '@/lib/audit'
import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { folderIdSchema, folderNameSchema } from '@/lib/folders/schema'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { prismaAnswers } from '@/lib/http/prisma'
import { apiResponse } from '@/lib/http/response'
import type { RouteContract } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'
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

/** The signed-in account as it is now, holding every one of `permissions`. */
export async function archiveActor(
  request: Request,
  permissions: Permission[]
): Promise<ArchiveActor> {
  const { account } = await requireSession(request, undefined, {
    refuseApiCredentials: true,
    fresh: true,
  })
  setAuditActor({ id: account.id, name: account.name })
  const access = await getUserAccess(account.id)
  if (permissions.some((permission) => !hasPermission(access, permission)))
    throw new ArchiveError(
      'You do not have permission for this archive operation.',
      403
    )
  return {
    user: {
      id: account.id,
      urlId: account.urlId,
      vanityId: account.vanityId,
      storageUsed: account.storageUsed,
      randomizeFileUrls: account.randomizeFileUrls,
      ...access,
      credential: 'session',
    },
    sessionVersion: account.sessionVersion,
  }
}

/** Archive request bodies, streamed ones included, are small JSON documents. */
export const ARCHIVE_BODY_LIMIT = 16 * 1024

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
