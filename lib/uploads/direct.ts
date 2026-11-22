import type { Prisma } from '@prisma/client'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { hasPermission } from '@/lib/permissions/catalog'
import { getStorageProvider } from '@/lib/storage'

import { overCapacity, uploadCapacity } from './capacity'
import { uploadDisplayName } from './display-name'
import {
  cleanupUncommittedUpload,
  finalizeUpload,
  prepareUploadDestination,
} from './finalize'
import { uploadLinks } from './links'
import {
  UploadError,
  applyUploadOverrides,
  parseUploadFields,
  requestUploadOptions,
  resolveUploadOptions,
} from './options'
import type { UploadRequestOptions } from './schema'

/**
 * An upload whose caller decided everything before the bytes arrive, such as
 * an MCP tool or a transfer URL. Nothing in the request can change it.
 */
export type FixedUpload = {
  /** Every option, decided by the caller; the request's headers, query and form fields are ignored. */
  options: UploadRequestOptions
  /** Replaces the multipart part's filename. */
  filename?: string
  isPaste?: boolean
  /** A password hash prepared earlier, in place of `options.password`. */
  passwordHash?: string | null
  /** Runs inside the publishing transaction after the existing rechecks; throw to refuse. */
  authorize?: (tx: Prisma.TransactionClient) => Promise<void>
}

type UploadLinks = ReturnType<typeof uploadLinks>

/**
 * Store the one file a multipart form sends and publish it. The file is
 * stored as it streams in, before Flare has read the fields after it, so its
 * profile, folder and naming come from the request's headers or query, and
 * the form's fields may only repeat them. A caller that passes `fixed` has
 * chosen all of that itself: the request then supplies only the file, and the
 * answer also names the new file's ID.
 */
export function directUpload(
  request: Request,
  user: AuthenticatedUser
): Promise<UploadLinks>
export function directUpload(
  request: Request,
  user: AuthenticatedUser,
  fixed: FixedUpload
): Promise<UploadLinks & { id: string }>
export async function directUpload(
  request: Request,
  user: AuthenticatedUser,
  fixed?: FixedUpload
): Promise<UploadLinks | (UploadLinks & { id: string })> {
  const isPaste = fixed
    ? fixed.isPaste === true
    : request.headers.get('X-Flare-Paste') === 'true'
  if (isPaste && !hasPermission(user, 'pastes.create'))
    throw new UploadError('You do not have permission to create pastes.', 403)
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    throw new UploadError('Content-Type must be multipart/form-data.')
  const fixedName =
    fixed?.filename === undefined
      ? undefined
      : uploadDisplayName(fixed.filename)
  if (fixedName === null) throw new UploadError('Invalid filename.')
  const selected = await resolveUploadOptions(
    user,
    fixed ? fixed.options : requestUploadOptions(request)
  )
  const capacity = uploadCapacity(await getConfig(), user, user.storageUsed)
  if (capacity.quotaBytes <= 0) throw overCapacity('quota')
  const storage = await getStorageProvider()
  let filePath = ''
  try {
    const { upload, fields, limitHit } = await parseSingleFileUpload({
      req: request,
      storageProvider: storage,
      maxBytes: capacity.fileBytes,
      quotaLimitBytes: capacity.quotaBytes,
      resolveDestination: async ({ filename }) => {
        const destination = await prepareUploadDestination(
          user,
          fixedName ?? filename,
          selected
        )
        filePath = destination.filePath
        return destination
      },
    })
    if (limitHit) throw overCapacity(limitHit)
    if (!upload) throw new UploadError('No file provided.')
    const file = await finalizeUpload({
      user,
      storage,
      ...upload,
      // Fixed options stand as resolved: the form's fields are never read.
      options: fixed
        ? selected
        : applyUploadOverrides(user, selected, parseUploadFields(fields)),
      isPaste,
      ...(fixed && {
        passwordHash: fixed.passwordHash,
        authorize: fixed.authorize,
        // These callers hand people a curl command, which names no type.
        adoptDetectedType: true,
      }),
    })
    return uploadLinks(file, user)
  } catch (error) {
    await cleanupUncommittedUpload(storage, filePath)
    throw error
  }
}
