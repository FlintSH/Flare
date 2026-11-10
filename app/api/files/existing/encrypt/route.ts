import {
  encryptFilesSchema,
  requestFileEncryption,
} from '@/lib/files/existing-choice'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/existing/encrypt', {
  envelope: 'api',
  failure: { message: 'Failed to queue the files for encryption' },
  logger: loggers.files,
})

/**
 * The owner asks the server to encrypt plain files that they selected, or to
 * try a failed file again (docs/e2ee-spec.md, section 14.2). The answer is
 * how many files wait now. Only a session of the owner is accepted.
 */
export const POST = api(
  async (request) => {
    const { user } = await requireSession(request, 'files.read', {
      refuseApiCredentials: true,
    })
    const { fileIds } = await readJson(request, encryptFilesSchema, {
      limit: 128 * 1024,
    })
    return apiResponse(await requestFileEncryption(user.id, fileIds))
  },
  { audit: { action: 'file.existing.encrypt', category: 'files' } }
)
