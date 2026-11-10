import { randomUUID } from 'node:crypto'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import {
  ENCRYPTED_FILE_TYPE,
  ENCRYPTED_PART_NAME,
  ENCRYPTED_UPLOAD_HEADER,
  EncryptedUploadError,
  encryptedDestination,
} from '@/lib/files/encrypted'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { hasPermission } from '@/lib/permissions/catalog'
import { getStorageProvider } from '@/lib/storage'

import { overCapacity, uploadCapacity } from './capacity'
import { assertEncryptedUploader, splitEncryptedFields } from './encrypted'
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
 *
 * An encrypted upload says so in `X-Flare-Encrypted: true`, for the same
 * reason: the server must know before the file part that it gets no name.
 * Its body is the header and the stored chunks of docs/e2ee-spec.md,
 * section 7, and its records are form fields.
 */
export async function directUpload(request: Request, user: AuthenticatedUser) {
  const isPaste = request.headers.get('X-Flare-Paste') === 'true'
  if (isPaste && !hasPermission(user, 'pastes.create'))
    throw new UploadError('You do not have permission to create pastes.', 403)
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    throw new UploadError('Content-Type must be multipart/form-data.')
  const encrypted = request.headers.get(ENCRYPTED_UPLOAD_HEADER) === 'true'
  if (encrypted) assertEncryptedUploader(user)
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
      resolveDestination: async ({ filename, mimeType }) => {
        if (encrypted) {
          // A real name here would be a client that leaks it by mistake.
          if (
            filename !== ENCRYPTED_PART_NAME ||
            mimeType !== ENCRYPTED_FILE_TYPE
          )
            throw new EncryptedUploadError(
              `An encrypted upload names its file part "${ENCRYPTED_PART_NAME}" with the type ${ENCRYPTED_FILE_TYPE}.`
            )
          const destination = encryptedDestination(user, randomUUID())
          filePath = destination.filePath
          return destination
        }
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
    const { records, options } = encrypted
      ? splitEncryptedFields(fields)
      : { records: null, options: fields }
    const file = await finalizeUpload({
      user,
      storage,
      ...upload,
      options: applyUploadOverrides(user, selected, parseUploadFields(options)),
      isPaste,
      encrypted: records,
    })
    return uploadLinks(file, user)
  } catch (error) {
    await cleanupUncommittedUpload(storage, filePath)
    throw error
  }
}
