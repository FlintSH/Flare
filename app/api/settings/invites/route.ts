import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { everyoneCanInvite, setEveryoneCanInvite } from '@/lib/invites/service'

const policySchema = z.object({ everyoneCanInvite: z.boolean() }).strict()

const api = routes('/api/settings/invites', {
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  await requireSession(request, 'settings.read')
  const config = await getConfig()
  return {
    everyoneCanInvite: await everyoneCanInvite(),
    limits: config.settings.general.registrations.inviteLimits,
  }
})

export const PUT = api(
  async (request) => {
    const { user } = await requireSession(request, 'settings.security')
    const parsed = policySchema.safeParse(
      await readJson(request, { limit: 32 * 1024 })
    )
    if (!parsed.success)
      throw new HttpError(400, 'Provide everyoneCanInvite as true or false')
    return setEveryoneCanInvite(user.id, parsed.data.everyoneCanInvite)
  },
  { failure: { message: 'Could not update invite settings' } }
)
