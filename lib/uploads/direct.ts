import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { hasPermission } from '@/lib/permissions/catalog'
import { getStorageProvider } from '@/lib/storage'

import { overCapacity, uploadCapacity } from './capacity'
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

/**
 * Store the one file a multipart form sends and publish it. The file is
 * stored as it streams in, before Flare has read the fields after it, so its
 * profile, folder and naming come from the request's headers or query, and
 * the form's fields may only repeat them.
 */
export async function directUpload(request: Request, user: AuthenticatedUser) {
  const isPaste = request.headers.get('X-Flare-Paste') === 'true'
  if (isPaste && !hasPermission(user, 'pastes.create'))
    throw new UploadError('You do not have permission to create pastes.', 403)
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    throw new UploadError('Content-Type must be multipart/form-data.')
  const selected = await resolveUploadOptions(
    user,
    requestUploadOptions(request)
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
          filename,
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
      options: applyUploadOverrides(user, selected, parseUploadFields(fields)),
      isPaste,
    })
    return uploadLinks(file, user)
  } catch (error) {
    await cleanupUncommittedUpload(storage, filePath)
    throw error
  }
}
