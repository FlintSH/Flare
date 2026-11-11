import { z } from 'zod'

import {
  SYNC_PAGE_MAX,
  SYNC_PAGE_SIZE,
  syncEncryptedFiles,
  syncFilesById,
  syncIndex,
} from '@/lib/files/sync'
import { requireSession } from '@/lib/http/access'
import { parseInput } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { BATCH_LIMIT } from '@/lib/library/contract'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/sync', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to read the encrypted records' },
  logger: loggers.files,
})

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)

/** One of three reads: changes after `since`, named `ids`, or the `index`. */
const querySchema = z.union([
  z.strictObject({
    index: z.literal('1'),
    after: id.optional(),
  }),
  z.strictObject({
    ids: z
      .string()
      .max(BATCH_LIMIT * 130)
      .transform((text) => text.split(','))
      .pipe(z.array(id).min(1).max(BATCH_LIMIT)),
  }),
  z.strictObject({
    since: z.coerce.number().int().min(0).max(2147483647).default(0),
    limit: z.coerce.number().int().min(1).max(SYNC_PAGE_MAX).optional(),
  }),
])

/**
 * The encrypted records of the owner's files for the local search cache
 * (docs/e2ee-spec.md, section 9.8.1). The browser opens them in memory and
 * searches there, so the server never gets a search for an encrypted name
 * or text. Only a browser session can read this: a token has no key that
 * opens the records.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const query = parseInput(
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if ('index' in query)
    return apiResponse(await syncIndex(user.id, query.after ?? null))
  if ('ids' in query)
    return apiResponse(await syncFilesById(user.id, query.ids))
  return apiResponse(
    await syncEncryptedFiles(
      user.id,
      query.since,
      query.limit ?? SYNC_PAGE_SIZE
    )
  )
})
