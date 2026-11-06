import { z } from 'zod'

import { emailSettingsRoutes, requireEmailAdmin } from '@/lib/email/admin'
import { retryMail } from '@/lib/email/outbox'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/settings/email/retry', emailSettingsRoutes)

export const POST = api(async (request) => {
  await requireEmailAdmin(request)
  const { id } = z
    .object({ id: z.string().min(1).max(100) })
    .parse(await readJson(request))
  const queued = await retryMail(id)
  if (!queued)
    throw new HttpError(
      400,
      'This message cannot be retried. Its account link may have expired or been replaced.'
    )
  return { data: { message: 'Message queued for retry' } }
})
