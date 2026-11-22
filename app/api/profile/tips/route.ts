import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { hideTip, hideTipSchema } from '@/lib/users/tips'

const api = routes('/api/profile/tips', {
  failure: { message: 'That tip could not be hidden.' },
  logger: loggers.users,
})

/** Hides one of Flare's page tips for the signed-in account. */
export const POST = api(
  async (request) => {
    const { session } = await requireSession(request)
    const { hide } = await readJson(request, hideTipSchema, { limit: 256 })
    return { data: { hidden: await hideTip(session.user.id, hide) } }
  },
  { invalid: () => new HttpError(400, 'Choose a tip Flare shows.') }
)
