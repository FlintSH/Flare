import { z } from 'zod'

import {
  accountStanzasSchema,
  oldAccountStanzas,
  replaceAccountStanzas,
} from '@/lib/files/stanza-migration'
import { requireSession } from '@/lib/http/access'
import { parseInput, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/stanzas', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to update the account stanzas' },
  logger: loggers.files,
})

/**
 * A batch of account stanzas that are still for an old account key, after a
 * key rotation (docs/e2ee-spec.md, section 8.3.4, step 1).
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const { after } = parseInput(
    z.strictObject({ after: z.string().min(1).max(128).optional() }),
    Object.fromEntries(new URL(request.url).searchParams)
  )
  return apiResponse(await oldAccountStanzas(user.id, after ?? null))
})

/**
 * The same stanzas, made again for the current account key by the owner's
 * browser (step 3). Only a browser session holds the old private keys.
 */
export const PUT = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const input = await readJson(request, accountStanzasSchema)
  return apiResponse(await replaceAccountStanzas(user.id, input))
})
