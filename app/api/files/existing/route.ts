import {
  chooseExistingFiles,
  existingFilesChoiceSchema,
} from '@/lib/files/existing-choice'
import { existingFilesStatus } from '@/lib/files/existing-encryption'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/existing', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to read the state of your existing files' },
  logger: loggers.files,
})

/**
 * The files of the owner from before end-to-end encryption: how many are
 * still plain, what the owner chose, and how far the server is with the
 * encryption (docs/e2ee-spec.md, section 14.2). Counts, IDs and codes only.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  return apiResponse(await existingFilesStatus(user.id))
})

/**
 * The answer of the owner: which existing files the server encrypts. Only a
 * session of the owner is accepted. An API token cannot answer for a person,
 * and an administrator cannot answer for another account.
 */
export const PUT = api(
  async (request) => {
    const { user } = await requireSession(request, 'files.read', {
      refuseApiCredentials: true,
    })
    const { choice } = await readJson(request, existingFilesChoiceSchema, {
      limit: 1024,
    })
    return apiResponse(await chooseExistingFiles(user.id, choice))
  },
  { audit: { action: 'file.existing.choice', category: 'files' } }
)
